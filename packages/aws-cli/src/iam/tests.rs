use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_policies {
    use super::*;
    use crate::iam::list_policies::{ListPolicies, list_policies};

    #[test]
    fn args_default() {
        let args = ListPolicies {
            marker: None,
            max_items: None,
            only_attached: Some(false),
            path_prefix: None,
            policy_usage_filter: None,
            scope: None,
        };
        assert!(!args.only_attached.unwrap());
        assert!(args.policy_usage_filter.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListPoliciesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
    <ListPoliciesResult>
        <IsTruncated>false</IsTruncated>
        <Marker>EXAMPLEkakv9BCuUNFDtxWSyfzetYwEx2ADc8dnzfvERF5S6YMvXKx41t6gCl/eeaCX3Jo94/bKqezEAg8TEVS
        99EKFLxm3jtbpl25FDWEXAMPLE
        </Marker>
        <Policies></Policies>
    </ListPoliciesResult>
</ListPoliciesResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_iam::Client::new(&config);
        let result = list_policies(
            &client,
            ListPolicies {
                marker: None,
                max_items: None,
                only_attached: None,
                path_prefix: None,
                policy_usage_filter: None,
                scope: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["policies"].as_array().unwrap().len(), 0);
    }
}

mod list_roles {
    use super::*;
    use crate::iam::list_roles::{ListRoles, list_roles};

    #[test]
    fn args_default() {
        let args = ListRoles {
            marker: None,
            max_items: None,
            path_prefix: None,
        };
        assert!(args.marker.is_none());
        assert!(args.path_prefix.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListRolesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
    <ListRolesResult>
        <IsTruncated>false</IsTruncated>
        <Roles></Roles>
    </ListRolesResult>
    <ResponseMetadata>
        <RequestId>20f7279f-99ee-11e1-a4c3-27EXAMPLE804</RequestId>
    </ResponseMetadata>
</ListRolesResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_iam::Client::new(&config);
        let result = list_roles(
            &client,
            ListRoles {
                marker: None,
                max_items: None,
                path_prefix: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["roles"].as_array().unwrap().len(), 0);
    }
}

mod list_users {
    use super::*;
    use crate::iam::list_users::{ListUsers, list_users};

    #[test]
    fn args_default() {
        let args = ListUsers {
            marker: None,
            max_items: None,
            path_prefix: None,
        };
        assert!(args.max_items.is_none());
        assert!(args.path_prefix.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListUsersResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
    <ListUsersResult>
        <IsTruncated>false</IsTruncated>
        <Users></Users>
    </ListUsersResult>
    <ResponseMetadata>
        <RequestId>7a62c49f-347e-4fc4-9331-6e8eEXAMPLE</RequestId>
    </ResponseMetadata>
</ListUsersResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_iam::Client::new(&config);
        let result = list_users(
            &client,
            ListUsers {
                marker: None,
                max_items: None,
                path_prefix: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["users"].as_array().unwrap().len(), 0);
    }
}
