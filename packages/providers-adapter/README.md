# AWS Credentials Adapter

A WASM component adapter that virtualizes the `component:aws-cli/credentials-provider` import by reading AWS credentials from environment variables.

## Overview

This adapter implements the credentials provider interface defined in the aws-cli component, reading credentials from standard AWS environment variables:

- `AWS_ACCESS_KEY_ID` - AWS access key ID (required)
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key (required)
- `AWS_SESSION_TOKEN` - Session token (optional)
