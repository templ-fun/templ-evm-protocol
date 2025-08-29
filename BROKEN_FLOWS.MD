# XMTP Integration Issues

## Current Status
The integration tests and e2e tests are using real XMTP SDK clients without any mocks or workarounds. However, there is a fundamental issue with group visibility between different XMTP client instances.

## The Core Issue
When the backend server creates an XMTP group and attempts to add the priest as a member, the priest's XMTP client cannot see or access the group, even after syncing.

### Technical Details

1. **Group Creation Flow**:
   - Server XMTP client creates a group using `newGroup([priestInboxId])`
   - The group is created successfully (returns a valid group ID)
   - However, the group has 0 members despite passing the priest's inbox ID
   - The priest client cannot see the group even after calling `sync()`

2. **Observed Behavior**:
   - Creating groups with initial members silently fails to add those members
   - Even creating a DM between clients fails with the same error
   - All XMTP operations throw "synced 1 messages, 0 failed 1 succeeded" as an error, despite the operation succeeding

3. **Client Configuration**:
   ```javascript
   // All clients are created with the same configuration
   const client = await Client.create(signer, {
     dbEncryptionKey,
     env: 'dev',
     loggingLevel: 'off'
   });
   ```

## Root Causes

### 1. XMTP SDK Sync Errors
The SDK consistently throws success messages as errors:
```
Error: synced 1 messages, 0 failed 1 succeeded from cursor Some(11677832)
```
This appears to be an SDK bug where successful sync operations are reported as errors.

### 2. Cross-Client Group Membership
XMTP groups created by one client instance cannot properly add members from other unconnected client instances. This is likely because:
- Each client has its own identity on the XMTP network
- Groups are tied to the creating client's identity
- There's no built-in mechanism for cross-client group invitations in the current implementation

### 3. Missing Group Discovery
The documentation mentions `syncAll()` for discovering new group memberships, but this method doesn't exist in the Node SDK - it may be browser-specific.

## Attempted Solutions

1. **Using syncAll()** - Method doesn't exist in Node SDK
2. **Handling consent states** - No effect on group visibility
3. **Creating groups with initial members** - Members aren't added (group has 0 members)
4. **Adding members after group creation** - `addMembers()` call times out
5. **Creating DMs first to establish connectivity** - DM creation also fails with sync errors
6. **Multiple sync attempts with delays** - No effect on group visibility

## Working Approaches (Not Implemented)

Based on XMTP documentation and SDK tests, potential solutions include:

1. **Priest Creates Own Group**: Have the priest create the group instead of the server
2. **Group Invite Links**: Implement proper invite link flow (requires additional infrastructure)
3. **Shared Identity**: Use the same XMTP identity for server and priest (security risk)

## Current Implementation Status

- ✅ All tests use real XMTP clients (no mocks)
- ✅ Real backend server with SQLite database
- ✅ Real Hardhat blockchain for smart contracts
- ✅ All 7 core flows implemented in UI
- ❌ Groups created by server not visible to priest
- ❌ Cross-client group membership not working

## Next Steps

To resolve this issue, consider:

1. **Architecture Change**: Have priests create their own groups rather than the server
2. **XMTP SDK Update**: Wait for SDK fixes or updates that properly handle cross-client groups
3. **Alternative Messaging**: Use a different group messaging solution that supports the required architecture
4. **Invite System**: Implement a proper group invitation system with acceptance flow

## References

- [XMTP Group Permissions](https://docs.xmtp.org/inboxes/core-messaging/group-permissions)
- [XMTP Create Conversations](https://docs.xmtp.org/inboxes/core-messaging/create-conversations)
- [XMTP SDK Tests](https://github.com/xmtp/xmtp-js/blob/main/sdks/node-sdk/test/Conversations.test.ts)