---
name: onboard
description: Register the current Claude Code session as an aboard worker on a topic, so it can publish updates to and receive messages from the coordinator. Use when the user says things like "/onboard", "/onboard billing", "join the aboard topic for this project", or "register me as a worker".
argument-hint: "[topic]"
allowed-tools: Bash(npx aboard-server*), Bash(node *), Bash(curl *), Bash(cat *), Bash(pwd*), Bash(basename*), Bash(mkdir *), Bash(uuidgen*), mcp__plugin_aboard_aboard-mcp__coordination_get_server_status, mcp__plugin_aboard_aboard-mcp__coordination_register_agent, mcp__plugin_aboard_aboard-mcp__coordination_list_topics, mcp__plugin_aboard_aboard-mcp__coordination_subscribe, mcp__plugin_aboard_aboard-mcp__coordination_publish
---

# onboard

Registers the current session as an aboard **worker**.

Usage:

```
/onboard
/onboard billing
```

`$ARGUMENTS` holds whatever the user typed after `/onboard`, if anything.

## Steps

1. **Discover / start the server.**
   Call `coordination_get_server_status`. If it fails to connect, start the
   server in the background (e.g.
   `nohup npx aboard-server > /tmp/aboard-server.log 2>&1 & disown`) and
   retry until it reports healthy.

2. **Determine this agent's identity.**
   Reuse the native Claude Code session identifier when available (check
   `$CLAUDE_CODE_BRIDGE_SESSION_ID`, then `$CLAUDE_CODE_REMOTE_SESSION_ID`,
   then `$CLAUDE_SESSION_ID`). Otherwise generate a UUID and keep reusing it
   for the rest of this session.

3. **Determine the topic.**
   - If `$ARGUMENTS` is non-empty, use it verbatim as the topic.
   - Otherwise, infer one: derive a candidate from the current project
     directory name (e.g. `basename "$(pwd)"`, lowercased, slashes/spaces
     replaced with `-`). Call `coordination_list_topics` to see what already
     exists and avoid an unrelated collision — reusing an existing topic
     that clearly matches this project is fine and often desirable; only
     pick a different name to avoid clashing with an unrelated project that
     happens to share a directory name.

4. **Register as a worker.**
   Call `coordination_register_agent` with `role: "worker"` and the agentId
   from step 2.

5. **Subscribe to the chosen topic.**
   Call `coordination_subscribe` with that `agentId` and `topic`. Keep the
   returned `subscriptionId` — you will need it later to wait for messages
   from the coordinator.

6. **Publish an onboarding announcement.**
   Call `coordination_publish` on the topic with a short `text` such as
   `"worker onboarded"` (include a `displayName` in `sender` if you have a
   good short label for this session).

7. **Report the outcome.**
   Tell the user which topic they were registered on and the
   `subscriptionId`, so they can later reference it (e.g. when asking you to
   check for coordinator messages).

Remember: this registration is entirely in-memory on the server. If the
server restarts, run `/onboard` again to rejoin.
