use crate::model::{FieldType, SmithyModel};
use crate::services::is_existing_op;

pub fn to_snake(s: &str) -> String {
    s.replace('-', "_")
}

pub fn to_pascal(s: &str) -> String {
    s.split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
            }
        })
        .collect()
}

/// Generate a single operation file.
pub fn generate_operation(
    sdk: &str,
    service: &str,
    operation: &str,
    model: Option<&SmithyModel>,
) -> String {
    let struct_name = to_pascal(operation);
    let fn_name = to_snake(operation);

    let input_fields = model.map(|m| m.input_fields(operation)).unwrap_or_default();
    let output_fields = model
        .map(|m| m.output_fields(operation))
        .unwrap_or_default();

    // Filter input fields: skip NestedObject, DeepNested, Timestamp
    let usable_inputs: Vec<_> = input_fields
        .iter()
        .filter(|f| match &f.shape_type {
            FieldType::NestedObject | FieldType::DeepNested | FieldType::Timestamp => false,
            FieldType::List(inner) => !matches!(
                **inner,
                FieldType::NestedObject | FieldType::DeepNested | FieldType::Timestamp
            ),
            _ => true,
        })
        .collect();

    // Struct fields
    let struct_fields = if usable_inputs.is_empty() {
        "#[arg(long)]\n    pub max_results: Option<i32>,\n".to_string()
    } else {
        usable_inputs
            .iter()
            .map(|f| {
                let is_required = f.required;
                let rust_type = f.shape_type.to_rust_type(is_required);
                let doc = if f.doc.is_empty() { &f.name } else { &f.doc };
                format!(
                    "/// {doc}\n    #[arg(long)]\n    pub {}: {rust_type},\n",
                    f.rust_name
                )
            })
            .collect::<String>()
    };

    // Generate builder args
    let builder_args = usable_inputs
        .iter()
        .map(|f| {
            let rn = &f.rust_name;
            let is_required = f.required;
            match (&f.shape_type, is_required) {
                (FieldType::Boolean, true) => format!(
                    "req = req.{rn}(args.{rn});\n"
                ),
                (FieldType::Boolean, false) => format!(
                    "if let Some(val) = args.{rn} {{\nreq = req.{rn}(val);\n    }}\n"
                ),
                (FieldType::Integer | FieldType::Long, true) => format!(
                    "req = req.{rn}(args.{rn});\n"
                ),
                (FieldType::Integer | FieldType::Long, false) => format!(
                    "if let Some(val) = args.{rn} {{\nreq = req.{rn}(val);\n    }}\n"
                ),
                (FieldType::List(inner), _) if **inner == FieldType::Enum => format!(
                    "if let Some(val) = args.{rn} {{\nreq = req.set_{rn}(Some(val.into_iter().map(|s| s.as_str().into()).collect()));\n    }}\n"
                ),
                (FieldType::List(_), _) => format!(
                    "if let Some(val) = args.{rn} {{\nreq = req.set_{rn}(Some(val));\n    }}\n"
                ),
                (FieldType::Enum, true) => format!(
                    "req = req.{rn}(args.{rn}.as_str().into());\n"
                ),
                (FieldType::Enum, false) => format!(
                    "if let Some(ref val) = args.{rn} {{\nreq = req.{rn}(val.as_str().into());\n    }}\n"
                ),
                (_, true) => format!(
                    "req = req.{rn}(&args.{rn});\n"
                ),
                (_, false) => format!(
                    "if let Some(ref val) = args.{rn} {{\nreq = req.{rn}(val);\n    }}\n"
                ),
            }
        })
        .collect::<String>();

    // Response body
    let response_body = generate_response_body(&output_fields, operation, model);

    format!(
        r#"use anyhow::{{Error, Result}};
use {sdk}::Client;
use clap::Args;

/// Arguments for `{service} {operation}`.
#[derive(Debug, Clone, Args)]
pub struct {struct_name} {{
{struct_fields}}}

/// Execute `{service} {operation}`.
pub(crate) async fn {fn_name}(
    client: &Client,
    args: {struct_name},
) -> Result<serde_json::Value, Error> {{
  tracing::debug!("Preparing `{struct_name}` operation to AWS SDK");
  let mut req = client.{fn_name}();
{builder_args}  let resp = req.send().await?;
{response_body}
}}
"#
    )
}

fn generate_response_body(
    output_fields: &[crate::model::ShapeField],
    operation: &str,
    model: Option<&SmithyModel>,
) -> String {
    if output_fields.is_empty() {
        return "Ok(serde_json::json!({}))".to_string();
    }

    let fields_json: Vec<String> = output_fields
        .iter()
        .filter(|f| f.shape_type != FieldType::DeepNested)
        .map(|f| {
            let rn = escape_rust_keyword(&f.rust_name);
            let jk = to_camel_case(&f.name);
            match &f.shape_type {
                FieldType::String => format!("\"{jk}\": resp.{rn}(),"),
                FieldType::Timestamp => {
                    format!("\"{jk}\": resp.{rn}().map(|v| v.to_string()),")
                }
                FieldType::Enum => {
                    format!("\"{jk}\": resp.{rn}().map(|v| v.as_str()),")
                }
                FieldType::Integer | FieldType::Long => {
                    format!("\"{jk}\": resp.{rn}(),")
                }
                FieldType::Boolean => format!("\"{jk}\": resp.{rn}(),"),
                FieldType::List(inner) if **inner == FieldType::Enum => {
                    format!("\"{jk}\": resp.{rn}().iter().map(|e| e.as_str()).collect::<Vec<_>>(),")
                }
                FieldType::List(inner)
                    if matches!(
                        **inner,
                        FieldType::String | FieldType::Integer | FieldType::Long
                    ) =>
                {
                    // Simple list of scalars — keep as-is
                    format!("\"{jk}\": resp.{rn}(),")
                }
                FieldType::List(_) => {
                    generate_nested_field(&f.rust_name, &jk, &f.name, operation, model)
                }
                FieldType::NestedObject => {
                    // Single nested struct (not a list) — use pretty Debug
                    format!("\"{jk}\": format!(\"{{:#?}}\", resp.{rn}()),")
                }
                _ => format!("\"{jk}\": resp.{rn}().map(|v| v.to_string()),"),
            }
        })
        .collect();

    if fields_json.is_empty() {
        "Ok(serde_json::json!({}))".to_string()
    } else {
        let joined = fields_json.join("\n");
        format!("Ok(serde_json::json!({{\n{joined}\n    }}))")
    }
}

/// Generate code for a nested list/object field in the response.
/// Expands scalar fields from the nested struct using the Smithy model.
fn generate_nested_field(
    rust_name: &str,
    json_key: &str,
    smithy_name: &str,
    operation: &str,
    model: Option<&SmithyModel>,
) -> String {
    let rn = escape_rust_keyword(rust_name);
    if let Some(m) = model {
        let nested = m.nested_shape_fields(operation, smithy_name);
        if !nested.is_empty() {
            let inner_fields: Vec<String> = nested
                .iter()
                .filter(|nf| {
                    // Skip required enums — SDK returns &Enum (not Option) which is incompatible with .map()
                    !(nf.shape_type == FieldType::Enum && nf.required)
                })
                .map(|nf| {
                    let nrn = escape_rust_keyword(&nf.rust_name);
                    let nk = to_camel_case(&nf.name);
                    match &nf.shape_type {
                        FieldType::Timestamp if nf.required => {
                            format!("\"{nk}\": v.{nrn}().to_string(),")
                        }
                        FieldType::Timestamp => {
                            format!("\"{nk}\": v.{nrn}().map(|t| t.to_string()),")
                        }
                        FieldType::Enum => {
                            format!("\"{nk}\": v.{nrn}().map(|e| e.as_str()),")
                        }
                        FieldType::List(inner) if **inner == FieldType::Enum => {
                            format!("\"{nk}\": v.{nrn}().iter().map(|e| e.as_str()).collect::<Vec<_>>(),")
                        }
                        FieldType::List(inner) if matches!(**inner, FieldType::NestedObject) => {
                            format!("\"{nk}\": v.{nrn}().iter().map(|e| format!(\"{{:?}}\", e)).collect::<Vec<_>>(),")
                        }
                        FieldType::List(_) => {
                            format!("\"{nk}\": v.{nrn}().iter().map(|e| format!(\"{{:?}}\", e)).collect::<Vec<_>>(),")
                        }
                        _ => format!("\"{nk}\": v.{nrn}(),"),
                    }
                })
                .collect();

            let inner = inner_fields.join("\n");
            return format!(
                "\"{json_key}\": resp.{rn}().iter().map(|v| serde_json::json!({{\n{inner}\n    }})).collect::<Vec<_>>(),",
            );
        }
    }
    // Fallback for single nested objects (not lists)
    format!("\"{json_key}\": format!(\"{{:?}}\", resp.{rn}()),")
}

/// Generate mod.rs for a service.
pub fn generate_mod(operations: &[String], has_tests: bool) -> String {
    let mut lines: Vec<String> = operations
        .iter()
        .map(|op| format!("pub mod {};", to_snake(op)))
        .collect();
    lines.sort();
    lines.dedup();
    if has_tests {
        lines.push("\n#[cfg(test)]\nmod tests;".to_string());
    }
    lines.join("\n") + "\n"
}

/// Generate tests.rs for a service.
pub fn generate_tests(service: &str, operations: &[String], model: Option<&SmithyModel>) -> String {
    let mut imports = String::new();
    let mut test_fns = String::new();

    for op in operations {
        if is_existing_op(service, op) {
            continue;
        }
        let fn_name = to_snake(op);
        let struct_name = to_pascal(op);

        imports.push_str(&format!("use super::{fn_name}::{struct_name};\n"));

        let input_fields = model.map(|m| m.input_fields(op)).unwrap_or_default();

        // Only include fields that are usable as CLI args
        let usable: Vec<_> = input_fields
            .iter()
            .filter(|f| match &f.shape_type {
                FieldType::NestedObject | FieldType::DeepNested | FieldType::Timestamp => false,
                FieldType::List(inner) => !matches!(
                    **inner,
                    FieldType::NestedObject | FieldType::DeepNested | FieldType::Timestamp
                ),
                _ => true,
            })
            .collect();

        let field_inits = if usable.is_empty() {
            "max_results: None".to_string()
        } else {
            usable
                .iter()
                .map(|f| {
                    if f.required {
                        match &f.shape_type {
                            FieldType::Integer | FieldType::Long => {
                                format!("{}: 1", f.rust_name)
                            }
                            FieldType::Boolean => format!("{}: true", f.rust_name),
                            _ => format!("{}: \"test\".to_string()", f.rust_name),
                        }
                    } else {
                        format!("{}: None", f.rust_name)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ")
        };

        test_fns.push_str(&format!(
            r###"#[test]
fn test_{fn_name}_args() {{
  let args = {struct_name} {{ {field_inits} }};
  let _ = format!("{{:?}}", args);
}}

"###
        ));
    }

    format!("{imports}\n{test_fns}\n")
}

fn to_camel_case(s: &str) -> String {
    // If the whole string is uppercase (acronym like "ID", "ARN"), lowercase it entirely
    if s.chars().all(|c| c.is_uppercase() || !c.is_alphabetic()) {
        return s.to_lowercase();
    }

    // Split into words respecting acronyms:
    // "DNSName" -> ["DNS", "Name"]
    // "DBInstances" -> ["DB", "Instances"]
    // "LoadBalancerARN" -> ["Load", "Balancer", "ARN"]
    let chars: Vec<char> = s.chars().collect();
    let mut words: Vec<String> = Vec::new();
    let mut start = 0;

    for i in 1..chars.len() {
        let prev_upper = chars[i - 1].is_uppercase();
        let curr_upper = chars[i].is_uppercase();
        let curr_lower = chars[i].is_lowercase();

        // Boundary: lowercase followed by uppercase (camelCase)
        if !prev_upper && curr_upper {
            words.push(chars[start..i].iter().collect());
            start = i;
        }
        // Boundary: uppercase followed by uppercase then lowercase (end of acronym)
        // e.g. in "DNSName", at 'N' (index 2): chars[1]='N' upper, chars[2]='S' upper — no split
        //      at 'N' (index 3): chars[2]='S' upper, chars[3]='N' upper, chars[4]='a' lower → split before index 3
        else if i >= 2
            && prev_upper
            && curr_upper
            && i + 1 < chars.len()
            && chars[i + 1].is_lowercase()
        {
            words.push(chars[start..i].iter().collect());
            start = i;
        }
        // Boundary: last char in all-upper sequence at end of string
        else if prev_upper && curr_lower && i - start > 1 {
            words.push(chars[start..i - 1].iter().collect());
            start = i - 1;
        }
    }
    // Push remaining
    if start < chars.len() {
        words.push(chars[start..].iter().collect());
    }

    // Join: first word lowercase, rest capitalize only first letter
    let mut result = String::new();
    for (i, word) in words.iter().enumerate() {
        if i == 0 {
            result.push_str(&word.to_lowercase());
        } else {
            let mut wchars = word.chars();
            if let Some(first) = wchars.next() {
                result.push(first.to_uppercase().next().unwrap());
                for c in wchars {
                    result.push(c.to_lowercase().next().unwrap());
                }
            }
        }
    }
    if result.is_empty() {
        s.to_lowercase()
    } else {
        result
    }
}

/// Escape Rust reserved keywords with r# prefix.
fn escape_rust_keyword(name: &str) -> String {
    match name {
        "type" | "match" | "move" | "ref" | "self" | "super" | "use" | "mod" | "fn" | "pub"
        | "let" | "mut" | "return" | "if" | "else" | "for" | "while" | "loop" | "break"
        | "continue" | "struct" | "enum" | "trait" | "impl" | "where" | "async" | "await"
        | "dyn" | "static" | "const" | "extern" | "crate" | "as" | "in" | "box" | "yield" => {
            format!("r#{name}")
        }
        _ => name.to_string(),
    }
}
