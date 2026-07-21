---
name: offboard
description: Remove the current Claude Code session's aboard worker registration and subscriptions. Use when the user says things like "/offboard", "leave the aboard topic", or "stop being an aboard worker".
argument-hint: "[farewell message]"
allowed-tools: mcp__plugin_aboard_aboard-mcp__coordination_get_server_status, mcp__plugin_aboard_aboard-mcp__coordination_publish, mcp__plugin_aboard_aboard-mcp__coordination_unsubscribe, mcp__plugin_aboard_aboard-mcp__coordination_unregister_agent, mcp__plugin_aboard_aboard-mcp__coordination_list_subscriptions
---

# offboard

Removes this session's aboard worker registration.

Usage:

```
/offboard
/offboard heading out, resuming tomorrow
```

`$ARGUMENTS`, if present, is used as an optional departure message.

## Steps

1. **Identify this session's registration.**
   Use the agentId and subscriptionId established earlier in this session by
   `/onboard` (or `coordination_list_subscriptions` if you need to look them
   up again).

2. **Publish an optional departure message.**
   If `$ARGUMENTS` is non-empty, or a farewell is otherwise appropriate,
   call `coordination_publish` on this worker's topic with that text (e.g.
   `"worker offboarded: <message>"`). Skip this step if the server is
   unreachable — offboarding should still succeed locally in that case.

3. **Remove subscriptions.**
   Call `coordination_unsubscribe` for every subscription belonging to this
   agent.

4. **Remove the agent registration.**
   Call `coordination_unregister_agent` with this agentId.

5. **Confirm to the user** that they have been offboarded and are no longer
   receiving aboard messages on that topic.

The user can always keep interacting with you directly — offboarding only
stops aboard coordination traffic, it does not end the session.
