pub mod cp;
pub mod ls;
pub mod mv;
pub mod rm;

/// Parse an S3 URI (s3://bucket/key) into (bucket, key) components.
/// Returns None if the path doesn't start with "s3://".
pub(crate) fn parse_s3_uri(uri: &str) -> Option<(String, String)> {
    let stripped = uri.strip_prefix("s3://")?;
    let (bucket, key) = match stripped.find('/') {
        Some(pos) => (stripped[..pos].to_string(), stripped[pos + 1..].to_string()),
        None => (stripped.to_string(), String::new()),
    };
    Some((bucket, key))
}

/// Determine if a path is an S3 URI.
pub(crate) fn is_s3_uri(path: &str) -> bool {
    path.starts_with("s3://")
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_parse_s3_uri_with_key() {
        let (bucket, key) = parse_s3_uri("s3://my-bucket/path/to/file.txt").unwrap();
        assert_eq!(bucket, "my-bucket");
        assert_eq!(key, "path/to/file.txt");
    }

    #[test]
    fn test_parse_s3_uri_bucket_only() {
        let (bucket, key) = parse_s3_uri("s3://my-bucket").unwrap();
        assert_eq!(bucket, "my-bucket");
        assert_eq!(key, "");
    }

    #[test]
    fn test_parse_s3_uri_with_trailing_slash() {
        let (bucket, key) = parse_s3_uri("s3://my-bucket/prefix/").unwrap();
        assert_eq!(bucket, "my-bucket");
        assert_eq!(key, "prefix/");
    }

    #[test]
    fn test_parse_s3_uri_invalid() {
        assert!(parse_s3_uri("/local/path").is_none());
        assert!(parse_s3_uri("http://example.com").is_none());
    }

    #[test]
    fn test_is_s3_uri() {
        assert!(is_s3_uri("s3://bucket/key"));
        assert!(!is_s3_uri("/local/file"));
        assert!(!is_s3_uri("./relative"));
    }
}
