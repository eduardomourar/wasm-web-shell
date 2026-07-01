use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event, replay_event_with_protocol,
};

mod get_object {
    use super::*;
    use crate::s3api::get_object::{GetObject, get_object};
    use std::path::PathBuf;

    #[async_test]
    async fn read_to_file() {
        let test_content = "This is test README content.\nLine 2 of the file.\n";

        let config = TestConfigBuilder::new()
            .region("us-east-1")
            .replay_event(replay_event(200, test_content))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let output = PathBuf::from("/tmp/test-readme.txt");

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "test-file.txt".to_string(),
                outfile: Some(output.clone()),
            },
        )
        .await
        .unwrap();

        // When writing to file, result should be None
        assert!(result.is_none());

        // Verify file was created
        assert!(output.exists());

        // Verify content
        let content = std::fs::read_to_string(&output).unwrap();
        assert_eq!(content, test_content);

        // Clean up
        std::fs::remove_file(output).ok();
    }

    #[async_test]
    async fn read_to_stdout() {
        let test_content = "{\"test\":\"data\"}\n";

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, test_content))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "test.jsonl".to_string(),
                outfile: None,
            },
        )
        .await
        .unwrap()
        .unwrap();

        // Verify content returned (get_object returns Vec<u8>)
        let result_str = String::from_utf8_lossy(&result);
        assert_eq!(result_str, test_content);
        assert!(result_str.contains("test"));
        assert!(result_str.contains("data"));
    }

    #[async_test]
    async fn read_empty() {
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, ""))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "empty.txt".to_string(),
                outfile: None,
            },
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(result, Vec::<u8>::new());
    }
}

mod list_buckets {
    use super::*;
    use crate::s3api::list_buckets::{ListBuckets, list_buckets};

    #[test]
    fn args_default() {
        let args = ListBuckets {
            bucket_region: None,
            continuation_token: None,
            max_buckets: None,
            prefix: None,
        };
        assert!(args.bucket_region.is_none());
        assert!(args.prefix.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Owner>
        <ID>AIDACKCEVSQ6C2EXAMPLE</ID>
    </Owner>
    <Buckets></Buckets>
</ListBucketResult>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::RestXml,
            ))
            .build()
            .await;
        let client = aws_sdk_s3::Client::new(&config);
        let result = list_buckets(
            &client,
            ListBuckets {
                bucket_region: None,
                continuation_token: None,
                max_buckets: None,
                prefix: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["buckets"].as_array().unwrap().len(), 0);
    }
}

mod list_objects {
    use super::*;
    use crate::s3api::list_objects::{ListObjects, list_objects};

    #[test]
    fn args_default() {
        let args = ListObjects {
            bucket: "test".to_string(),
            delimiter: None,
            encoding_type: None,
            expected_bucket_owner: None,
            marker: None,
            max_keys: None,
            optional_object_attributes: None,
            prefix: None,
            request_payer: None,
        };
        assert_eq!(args.bucket, "test");
        assert!(args.delimiter.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>test</Name>
    <IsTruncated>false</IsTruncated>
</ListBucketResult>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::RestXml,
            ))
            .build()
            .await;
        let client = aws_sdk_s3::Client::new(&config);
        let result = list_objects(
            &client,
            ListObjects {
                bucket: "test".to_string(),
                delimiter: None,
                encoding_type: None,
                expected_bucket_owner: None,
                marker: None,
                max_keys: None,
                optional_object_attributes: None,
                prefix: None,
                request_payer: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["contents"].as_array().unwrap().len(), 0);
    }
}
