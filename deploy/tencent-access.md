# Tencent integrations on your Docker host

You operate Instill's containers, HTTPS and persistent data on your chosen Linux amd64 or arm64 host. Tencent supplies optional ADP chat, ADP knowledge synchronization and a private COS archive. Follow [DEPLOY.md](../DEPLOY.md) for the host; no Tencent CVM or infrastructure-provisioning credentials are required.

## Start with external services disabled

Keep these settings in the host's ignored `.env.deploy` until the selected Tencent service's free allowance, expiry and overage behavior have been verified:

```dotenv
AI_PROVIDER=local
ADP_KNOWLEDGE_SYNC=false
ADP_AUTO_PUBLISH=false
COS_BUCKET=
```

The $0 Tencent spending limit still applies. The [hackathon guide](../docs/hackathon_requirements/ADP_Hackathon_Guide_EN.pdf), page 1, describes knowledge-base and DeepSeek allowances, but the actual account must have the required entitlement. Check its model/PU allowance, knowledge capacity and expiry in ADP's billing resources; older accounts may use the Billing Resource List instead. Confirm paid fallback and automatic renewal are disabled where offered. Do not enable a service or run a connection test while its zero-cost coverage is uncertain. [ADP billing resources](https://proxy-hk.tencentcloud.com/document/product/1254/77767).

These switches are independent: `AI_PROVIDER=local` does not stop knowledge uploads when synchronization is enabled, or original-file uploads when `COS_BUCKET` is set. Instill does not enforce a Tencent spending cap.

## ADP chat: the minimum integration

1. Configure and publish a dedicated Instill application using the [agent setup guide and prompt](adp-agent.md). Confirm the account's model allowance before testing it.
2. Obtain the published application's AppKey from its API/call settings. Store it privately in the host's `.env.deploy` as `ADP_APP_KEY`. This is not a Tencent Cloud SecretKey, a cloud account APPID or the application's business ID. [Tencent's credential explanation](https://intl-sg.tencent-cloud.com/document/product/1254/69984).
3. When zero-cost usage is established, set `AI_PROVIDER=adp`. Keep synchronization off and `COS_BUCKET` empty for this first connection.

```dotenv
AI_PROVIDER=adp
ADP_APP_KEY='replace-privately-with-the-published-application-key'
ADP_ENDPOINT=https://wss.lke.tencentcloud.com/adp/v2/chat
ADP_KNOWLEDGE_SYNC=false
ADP_AUTO_PUBLISH=false
COS_BUCKET=
```

The backend makes an HTTPS POST and reads SSE responses; this is not a WebSocket URL. The endpoint and application publication requirement are documented in the [ADP chat API](https://intl-sg.tencent-cloud.com/document/product/1254/81449). Confirm that your application supports this API before changing the endpoint.

No `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` or `ADP_APP_BIZ_ID` is needed for chat alone. Instill supplies approved local knowledge in the request, so the agent can cite those records without copying the library into ADP. Recreate the container with your deployment's Compose command after editing its environment. Once covered usage is confirmed, a manager can use **Settings → Check connection** with fictional data; this makes a real model request and validates chat only.

## Optional ADP knowledge synchronization

Enable this only if you want approved Instill knowledge copied into ADP's managed library. It is separate from chat access and sends content externally even when the local advisor is selected.

| Setting                                   | Value or source                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADP_KNOWLEDGE_SYNC`                      | `true` only after management-API access, free capacity and processing locations are confirmed.                                                                                            |
| `ADP_APP_BIZ_ID`                          | The dedicated application's `BotBizId`, obtainable from its application URL/API settings. This is separate from `ADP_APP_KEY`; no separate knowledge-base ID is used by this integration. |
| `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` | Credentials for a dedicated CAM sub-user/role with the required ADP management access. Do not use the account owner's key.                                                                |
| `TENCENT_TOKEN`                           | Required with temporary credentials; otherwise empty. Refresh temporary credentials before expiry and recreate the container. Instill does not refresh them automatically.              |
| `TENCENT_REGION`                          | The region supported by this ADP management API and tenant. The implemented legacy international API documents `ap-jakarta` only; do not copy the Docker host or COS region.              |
| `ADP_AUTO_PUBLISH`                        | Keep `false` to review and publish uploaded drafts in ADP manually.                                                                                                                       |

The client uses `lke.intl.tencentcloudapi.com`, API version `2023-11-30`. Tencent places this API under its legacy management documentation. Verify the tenant supports it before enabling sync; chat access alone does not establish compatibility. The [upload-credential API](https://www.tencentcloud.com/ind/document/product/1254/70431) documents the endpoint and `ap-jakarta` restriction.

The runtime calls `DescribeStorageCredential`, `SaveDoc` and `DescribeDoc`. Automatic release and release-status tracking additionally use `CreateRelease` and `DescribeRelease`. Ask the account administrator to grant only the required operations and the dedicated application's supported scope, plus the appropriate ADP platform/workspace role. Tencent's [authorization guidance](https://indonesia.tencentcloud.com/document/product/1254/69984) requires both cloud permissions and ADP user-role assignment. Confirm the applicable CAM action/resource mapping in the account; this guide does not claim an unverified application-level CAM policy.

ADP issues temporary credentials for its own private upload location; this path does not require your own COS bucket or general COS permissions. The returned bucket region is separate from the API request region. [ADP-managed COS uploads](https://www-sg.tencentcloud.com/ind/document/product/1254/69981).

Only manager-approved knowledge is queued. Uploaded and parsed drafts must be published before ADP can retrieve them. Instill checks document publication status before treating a record as synchronized. `ADP_AUTO_PUBLISH=true` makes an application-wide release and can publish unrelated pending drafts: use it only for a dedicated application after reviewing that scope. See the [agent verification steps](adp-agent.md#verify-with-fictional-data).

## Optional private Singapore COS

This feature archives original uploaded files separately from ADP's managed knowledge. Leave `COS_BUCKET` empty unless its storage, requests and any traffic charges are covered. COS resource packages fall back to pay-as-you-go when depleted or expired; a free storage allowance alone does not establish zero-cost operation. [COS billing rules](https://www.tencentcloud.com/document/product/436/10373).

Use an existing dedicated **private** bucket whose actual region is Singapore. Set `COS_BUCKET` to its complete `name-APPID` value and `COS_REGION=ap-singapore`. Keep public read/write disabled. The backend sends HTTPS PUT requests to `<COS_BUCKET>.cos.ap-singapore.myqcloud.com`; changing an environment variable does not relocate a bucket.

The archive requires only `name/cos:PutObject` on the actual bucket's `originals/*` prefix. Its CAM resource pattern is `qcs::cos:ap-singapore:uid/<APPID>:<BUCKET-NAME-APPID>/originals/*`. Substitute the real APPID and bucket name; no list, read, delete or bucket-management permissions are needed by this upload path. [COS object authorization](https://indonesia.tencentcloud.com/ind/document/product/436/30580).

The current application shares the `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` and optional `TENCENT_TOKEN` settings between sync and archival. If both are enabled, scope that runtime identity to their combined required operations. Original-file archival does not back up SQLite, decisions or TLS certificates; maintain the host backups described in [DEPLOY.md](../DEPLOY.md).

## Credential handoff and legacy files

Store runtime values only in the host's ignored `.env.deploy`, restrict the file to its operator (`chmod 600 .env.deploy`), and keep credentials out of chat, Git, images and browser code. Preserve the normal production settings, including `APP_ACCESS_PASSWORD`; Tencent credentials do not replace Instill login. Docker administrators can inspect container environment variables.

The existing `.env.tencent` and [tencent-discovery-policy.json](tencent-discovery-policy.json) belong to the earlier, read-only CVM/voucher investigation. They are not used by Compose or the application and do not grant ADP chat, knowledge-write or COS-upload permissions. Do not copy those discovery keys into the runtime file. They are no longer needed for this hosting plan; the account owner can retire them when no other discovery work requires them.

Your host's location, the ADP API region and the original-file COS bucket are separate choices. Confirm the ADP tenant/model's actual processing and storage locations before sending customer material. Use fictional records for initial verification. Editing configuration does not verify service access; enable and test each integration only after its zero-cost coverage is established.
