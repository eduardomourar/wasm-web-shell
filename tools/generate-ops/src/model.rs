use serde_json::Value;

/// Parsed Smithy model providing operation input/output shape info.
pub struct SmithyModel {
    json: Value,
}

/// A field from a Smithy shape.
#[derive(Debug, Clone)]
pub struct ShapeField {
    pub name: String,
    pub rust_name: String, // snake_case
    pub shape_type: FieldType,
    pub required: bool,
    pub doc: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FieldType {
    String,
    /// Enum type — represented as String in CLI args but needs .into() for SDK
    Enum,
    Integer,
    Long,
    Boolean,
    Timestamp,
    List(Box<FieldType>),
    /// Nested structure within depth limit — include as Debug-formatted JSON
    NestedObject,
    /// Complex nested structure beyond depth 4 — skip entirely
    DeepNested,
    Unknown,
}

impl SmithyModel {
    pub fn new(json: Value) -> Self {
        Self { json }
    }

    /// Find input fields for an operation.
    pub fn input_fields(&self, operation: &str) -> Vec<ShapeField> {
        let op_shape = self.find_operation_shape(operation);
        let input_target = op_shape
            .and_then(|op| op.get("input"))
            .and_then(|i| i.get("target"))
            .and_then(|t| t.as_str());

        match input_target {
            Some(target) => self.extract_fields(target, true),
            None => Vec::new(),
        }
    }

    /// Find output fields for an operation.
    pub fn output_fields(&self, operation: &str) -> Vec<ShapeField> {
        let op_shape = self.find_operation_shape(operation);
        let output_target = op_shape
            .and_then(|op| op.get("output"))
            .and_then(|i| i.get("target"))
            .and_then(|t| t.as_str());

        match output_target {
            Some(target) => self.extract_fields(target, false),
            None => Vec::new(),
        }
    }

    /// Get the scalar fields of a nested structure shape (for expanding in output).
    /// Returns fields that are simple scalars (String, Integer, Boolean, Enum, Timestamp).
    /// Limits to top 8 fields to avoid huge output.
    pub fn nested_shape_fields(&self, operation: &str, field_name: &str) -> Vec<ShapeField> {
        let shapes = match self.json.get("shapes").and_then(|s| s.as_object()) {
            Some(s) => s,
            None => return Vec::new(),
        };

        // Find the operation's output shape
        let op_shape = self.find_operation_shape(operation);
        let output_target = op_shape
            .and_then(|op| op.get("output"))
            .and_then(|i| i.get("target"))
            .and_then(|t| t.as_str());

        let output_id = match output_target {
            Some(t) => t,
            None => return Vec::new(),
        };

        // Find the field's target shape in the output
        let output_shape = match shapes.get(output_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let member = output_shape
            .get("members")
            .and_then(|m| m.as_object())
            .and_then(|m| m.get(field_name));

        let member_target = member
            .and_then(|m| m.get("target"))
            .and_then(|t| t.as_str());

        let target_id = match member_target {
            Some(t) => t,
            None => return Vec::new(),
        };

        // If it's a list, get the list member's target
        let actual_struct_id = match shapes.get(target_id) {
            Some(shape) if shape.get("type").and_then(|t| t.as_str()) == Some("list") => shape
                .get("member")
                .and_then(|m| m.get("target"))
                .and_then(|t| t.as_str())
                .unwrap_or(target_id),
            _ => target_id,
        };

        // Extract scalar fields from the nested struct
        let struct_shape = match shapes.get(actual_struct_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let members = match struct_shape.get("members").and_then(|m| m.as_object()) {
            Some(m) => m,
            None => return Vec::new(),
        };

        let mut fields = Vec::new();
        for (name, member_val) in members {
            let target = match member_val.get("target").and_then(|t| t.as_str()) {
                Some(t) => t,
                None => continue,
            };

            // Skip deprecated fields
            if member_val
                .get("traits")
                .and_then(|t| t.as_object())
                .map(|t| t.contains_key("smithy.api#deprecated"))
                .unwrap_or(false)
            {
                continue;
            }

            let field_type = self.resolve_type_with_depth(target, shapes, 2);
            // Include simple scalars, lists of scalars, and lists of nested objects
            match &field_type {
                FieldType::String
                | FieldType::Enum
                | FieldType::Integer
                | FieldType::Long
                | FieldType::Boolean
                | FieldType::Timestamp => {}
                FieldType::List(inner) => match **inner {
                    FieldType::String | FieldType::Enum | FieldType::NestedObject => {}
                    _ => continue,
                },
                _ => continue,
            }

            fields.push(ShapeField {
                name: name.clone(),
                rust_name: to_snake_case(name),
                shape_type: field_type,
                required: member_val
                    .get("traits")
                    .and_then(|t| t.get("smithy.api#required"))
                    .is_some(),
                doc: String::new(),
            });
        }

        fields.sort_by(|a, b| a.name.cmp(&b.name));
        fields.truncate(34);
        fields
    }

    fn find_operation_shape(&self, operation: &str) -> Option<&Value> {
        let shapes = self.json.get("shapes")?.as_object()?;
        let pascal = to_pascal_op(operation);
        let pascal_lower = pascal.to_lowercase();
        shapes.iter().find_map(|(key, val)| {
            if val.get("type")?.as_str()? == "operation" {
                let name = key.split('#').last()?;
                // Case-insensitive comparison to handle acronyms (DB, VPC, IAM, etc.)
                if name.to_lowercase() == pascal_lower {
                    return Some(val);
                }
            }
            None
        })
    }

    fn extract_fields(&self, shape_id: &str, for_input: bool) -> Vec<ShapeField> {
        let shapes = match self.json.get("shapes").and_then(|s| s.as_object()) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let shape = match shapes.get(shape_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let members = match shape.get("members").and_then(|m| m.as_object()) {
            Some(m) => m,
            None => return Vec::new(),
        };

        // Determine required fields
        let required_set: Vec<String> = shape
            .get("traits")
            .and_then(|t| t.get("smithy.api#required"))
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Also check per-member required trait
        let mut fields = Vec::new();

        for (member_name, member_val) in members {
            let target = match member_val.get("target").and_then(|t| t.as_str()) {
                Some(t) => t,
                None => continue,
            };

            // Skip deprecated fields
            if member_val
                .get("traits")
                .and_then(|t| t.as_object())
                .map(|t| t.contains_key("smithy.api#deprecated"))
                .unwrap_or(false)
            {
                continue;
            }

            let field_type = self.resolve_type(target, shapes);

            // Skip deeply nested structures (depth >= 4) for input args
            if for_input && field_type == FieldType::DeepNested {
                continue;
            }
            // Skip deeply nested for output too
            if !for_input && field_type == FieldType::DeepNested {
                continue;
            }

            let is_required = required_set.contains(member_name)
                || member_val
                    .get("traits")
                    .and_then(|t| t.get("smithy.api#required"))
                    .is_some();

            let doc = member_val
                .get("traits")
                .and_then(|t| t.get("smithy.api#documentation"))
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .replace("<p>", "")
                .replace("</p>", "");

            // Limit doc length
            let doc = if doc.len() > 80 {
                format!("{}...", &doc[..77])
            } else {
                doc.to_string()
            };

            fields.push(ShapeField {
                name: member_name.clone(),
                rust_name: to_snake_case(member_name),
                shape_type: field_type,
                required: is_required,
                doc,
            });
        }

        // Sort: required first, then alphabetical
        fields.sort_by(|a, b| b.required.cmp(&a.required).then(a.name.cmp(&b.name)));

        // For input: keep ALL required fields + up to 10 optional fields
        // For output: keep up to 15 fields
        if for_input {
            let required_count = fields.iter().filter(|f| f.required).count();
            let max_optional = 10;
            fields.truncate(required_count + max_optional);
        } else {
            fields.truncate(15);
        }

        fields
    }

    fn resolve_type(&self, target: &str, shapes: &serde_json::Map<String, Value>) -> FieldType {
        self.resolve_type_with_depth(target, shapes, 0)
    }

    fn resolve_type_with_depth(
        &self,
        target: &str,
        shapes: &serde_json::Map<String, Value>,
        depth: u8,
    ) -> FieldType {
        // Smithy prelude types
        match target {
            "smithy.api#String" | "com.amazonaws.s3#BucketName" => return FieldType::String,
            "smithy.api#Integer" => return FieldType::Integer,
            "smithy.api#Long" => return FieldType::Long,
            "smithy.api#Boolean" | "smithy.api#PrimitiveBoolean" => return FieldType::Boolean,
            "smithy.api#Timestamp" => return FieldType::Timestamp,
            _ => {}
        }

        let shape = match shapes.get(target) {
            Some(s) => s,
            None => return FieldType::Unknown,
        };

        // Check for enum trait (Smithy 2.0 uses string + @enum trait)
        let has_enum_trait = shape
            .get("traits")
            .and_then(|t| t.as_object())
            .map(|traits| {
                traits.contains_key("smithy.api#enum")
                    || traits.contains_key("smithy.api#enumValue")
            })
            .unwrap_or(false);

        match shape.get("type").and_then(|t| t.as_str()) {
            Some("string") if has_enum_trait => FieldType::Enum,
            Some("enum") => FieldType::Enum,
            Some("string") => FieldType::String,
            Some("integer") | Some("short") => FieldType::Integer,
            Some("long") => FieldType::Long,
            Some("boolean") => FieldType::Boolean,
            Some("timestamp") => FieldType::Timestamp,
            Some("list") => {
                let member_target = shape
                    .get("member")
                    .and_then(|m| m.get("target"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("smithy.api#String");
                let inner = self.resolve_type_with_depth(member_target, shapes, depth + 1);
                FieldType::List(Box::new(inner))
            }
            Some("structure") | Some("union") => {
                // depth 0 = top-level input/output shape (never reached here)
                // depth 1 = direct field of the input/output
                // depth 2,3 = nested objects — include as debug-formatted
                // depth >= 4 = too deep, skip entirely
                if depth >= 4 {
                    FieldType::DeepNested
                } else {
                    FieldType::NestedObject
                }
            }
            _ => {
                // Check if it has members (enum-like union in Smithy 2.0)
                if shape.get("members").is_some()
                    && shape.get("type").and_then(|t| t.as_str()) == Some("union")
                {
                    FieldType::Enum
                } else {
                    FieldType::Unknown
                }
            }
        }
    }
}

fn to_pascal_op(op: &str) -> String {
    op.split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
            }
        })
        .collect()
}

fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, &ch) in chars.iter().enumerate() {
        if ch.is_uppercase() {
            let prev_upper = i > 0 && chars[i - 1].is_uppercase();
            let next_lower = i + 1 < chars.len() && chars[i + 1].is_lowercase();
            // Insert underscore before:
            // - a capital that follows a lowercase (camelCase boundary)
            // - a capital that starts a new word after an acronym (e.g. "ID" -> last char before lowercase)
            if i > 0 && !prev_upper {
                result.push('_');
            } else if i > 0 && prev_upper && next_lower {
                // End of acronym: "XMLParser" -> "xml_parser"
                result.push('_');
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    result
}

impl FieldType {
    /// Convert to Rust type for clap Args (always String for enums/objects).
    pub fn to_rust_type(&self, required: bool) -> String {
        let inner = match self {
            FieldType::String | FieldType::Enum => "String".to_string(),
            FieldType::Integer => "i32".to_string(),
            FieldType::Long => "i64".to_string(),
            FieldType::Boolean => "bool".to_string(),
            FieldType::Timestamp => "String".to_string(),
            FieldType::List(_) => "Vec<String>".to_string(),
            FieldType::NestedObject => "String".to_string(), // JSON string for complex objects
            FieldType::DeepNested => "String".to_string(),
            FieldType::Unknown => "String".to_string(),
        };
        if required {
            inner
        } else {
            format!("Option<{inner}>")
        }
    }

    /// Whether this type needs `.into()` when passing to SDK builder.
    pub fn is_enum(&self) -> bool {
        matches!(self, FieldType::Enum)
    }
}
