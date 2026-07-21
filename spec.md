# Aboard

## Technical Specification v1.0

## Overview

**Aboard** is a lightweight coordination system for local coding-agent sessions.

It provides a shared communication layer that allows one coordinator agent to observe and coordinate multiple worker agents while allowing the user to continue interacting directly with any worker.

Aboard is **not**:

* a workflow engine
* a scheduler
* a durable message queue
* an event sourcing system
* a task database

Instead, it is a transient communication fabric that allows active coding sessions to coordinate.

---

# Goals

The system should allow a developer to:

* Start one coordinator session.
* Onboard any number of worker sessions.
* Organize workers into project topics.
* Allow workers to asynchronously notify the coordinator.
* Allow the coordinator to communicate back to workers.
* Keep communication completely ephemeral.
* Keep deployment simple enough that it can be installed with npm and launched with `npx`.

---

# High-Level Architecture

```
                +----------------------+
                |   Coordinator Agent  |
                +----------+-----------+
                           |
                           | MCP
                           |
                  +--------v---------+
                  |   aboard-mcp     |
                  |  MCP Adapter     |
                  +--------+---------+
                           |
                      HTTP + SSE
                           |
                  +--------v---------+
                  | aboard-server    |
                  | Message Bus      |
                  +--------+---------+
                           |
             +-------------+-------------+
             |             |             |
        Worker A      Worker B      Worker C
```

The MCP adapter contains no business logic.

It simply translates MCP tool calls into HTTP requests against the local server.

The coordination server owns all runtime state.

---

# Core Concepts

## Agent

An active coding session.

Roles:

* coordinator
* worker

Roles are metadata.

The architecture must allow future recursive coordination (coordinators coordinating coordinators) without changing the model.

---

## Coordinator

Responsibilities:

* Subscribe to every topic.
* Interpret worker messages.
* Produce summaries.
* Surface requests needing user attention.
* Publish messages back to workers.

The coordinator decides message semantics.

The server does not.

---

## Worker

Responsibilities:

* Participate in exactly one or more topics.
* Publish messages.
* Wait for incoming messages.
* Retry important messages if necessary.

Workers remain fully usable even if the coordinator disappears.

---

## Topic

A topic represents a body of work.

Examples:

* feature-x
* release-2026
* billing
* frontend-redesign

Topics:

* are flat
* are human-readable
* are not repositories
* may span multiple repositories
* may have multiple workers

Topics are ephemeral.

---

## Artifact

Artifacts are references only.

Supported types:

* local file path
* URL

No file transfer occurs through Aboard.

---

# Technology Stack

Language

* TypeScript

Runtime

* Node.js

Distribution

* npm
* npx

HTTP Framework

* Hono

Communication

* HTTP
* Server Sent Events (SSE)

MCP

* Official TypeScript MCP SDK

Persistence

* None

Database

* None

External Queue

* None

---

# Repository Layout

```
aboard/

├── package.json
├── tsconfig.json
├── README.md

├── docs/

├── src/

│   ├── shared/
│   │
│   ├── server/
│   │
│   ├── mcp/
│   │
│   └── cli/

├── skills/

│   ├── manage/
│   ├── onboard/
│   └── offboard/

└── test/
```

---

# Executables

The package provides two executables.

```
aboard-server
```

```
aboard-mcp
```

Examples

```
npx aboard-server
```

```
npx aboard-mcp
```

---

# Runtime Components

## aboard-server

Responsibilities

* Local HTTP server
* Topic registry
* Agent registry
* Subscription registry
* Message routing
* SSE waiting
* Coordinator ownership

Runs only on localhost.

No external exposure by default.

---

## aboard-mcp

Responsibilities

Expose MCP tools.

Translate tool calls into HTTP.

Contains **no** coordination logic.

---

# Discovery

Server discovery priority:

1. Explicit server URL
2. Environment variable
3. Local runtime discovery file

The discovery file contains only runtime information.

It is not persistent application state.

---

# Skills

The package provides three global Claude Code skills.

---

## manage

Starts or attaches the current session as coordinator.

Behavior

* Discover server.
* Start server if needed.
* Check for existing coordinator.
* Register current session.
* Subscribe to wildcard.
* Begin waiting for messages.

---

## onboard

Registers current session as worker.

Behavior

* Discover server.
* Determine session identity.
* Infer topic unless explicitly provided.
* Register worker.
* Subscribe worker.
* Publish "worker onboarded."
* Display chosen topic.

Examples

```
/onboard
```

```
/onboard billing
```

---

## offboard

Removes worker.

Behavior

* Remove subscriptions.
* Remove registration.
* Publish optional departure message.

---

# Agent Identity

Whenever possible:

Reuse the native Claude Code session identifier.

If unavailable:

Generate a UUID.

Agent identity is runtime identity only.

---

# Message Model

```
interface Message {

    id: string

    topic: string

    sender: {

        agentId: string

        role: "worker" | "coordinator"

        displayName?: string

    }

    text?: string

    artifacts?: Artifact[]

    metadata?: Record<string, unknown>

    sentAt: string

}
```

Messages are opaque.

The server never interprets them.

Every message is simply delivered.

No distinction exists between:

* request
* response
* event
* notification

Those are coordinator semantics.

---

# Topics

Topics are automatically created.

No explicit creation endpoint exists.

Topics disappear when the server stops.

---

# Message Delivery

Delivery is intentionally simple.

Properties

* fire-and-forget
* ephemeral
* no replay
* no persistence
* no acknowledgements
* no retries
* no ordering guarantees beyond in-process delivery

If nobody is listening:

The message is discarded.

This is intentional.

Workers should resend important messages when appropriate.

---

# Subscription Model

Workers subscribe to explicit topics.

Coordinator subscribes to:

```
*
```

Wildcard subscriptions receive every message.

---

# REST API

## Health

```
GET /health
```

Returns server health.

---

## Runtime State

```
GET /state
```

Returns:

* active agents
* topics
* subscriptions
* coordinator

---

# Coordinator

```
GET /coordinator
```

Returns current coordinator.

```
POST /coordinator/claim
```

Claims coordinator role.

Returns conflict if another exists.

```
DELETE /coordinator/{agentId}
```

Releases coordinator.

---

# Agents

```
POST /agents/register
```

```
DELETE /agents/{agentId}
```

```
GET /agents
```

```
GET /agents/{agentId}
```

---

# Topics

```
GET /topics
```

```
GET /topics/{topic}
```

---

# Subscriptions

```
POST /subscriptions
```

```
DELETE /subscriptions/{subscriptionId}
```

```
GET /subscriptions
```

---

# Messages

```
POST /messages
```

Publishes one message.

Returns

* message id
* number of recipients

---

# Waiting

Workers and coordinator wait using SSE.

Endpoint

```
GET /subscriptions/{subscriptionId}/events
```

Behavior

* connection stays alive
* heartbeat events emitted
* waits for first message
* returns first matching message
* connection closes
* caller reconnects

One message per wait operation.

---

# Heartbeats

Heartbeats exist only to maintain transport.

Suggested interval

20 seconds

Heartbeat events are **not** surfaced to agents.

---

# MCP Tool Set

The MCP server exposes the following tools.

## coordination_get_server_status

Server health.

---

## coordination_register_agent

Register current agent.

---

## coordination_unregister_agent

Remove agent.

---

## coordination_get_agent

Retrieve one agent.

---

## coordination_list_agents

List active agents.

---

## coordination_claim_coordinator

Become coordinator.

---

## coordination_release_coordinator

Release coordinator.

---

## coordination_list_topics

List topics.

---

## coordination_subscribe

Create subscription.

---

## coordination_unsubscribe

Remove subscription.

---

## coordination_publish

Publish one message.

---

## coordination_wait_for_message

Wait until

* first message
* timeout
* subscription closes

Returns

```
message
```

or

```
timeout
```

No streaming abstraction is exposed to the LLM.

---

# Topic Inference

When `/onboard` is executed without arguments:

1. Infer a project name.
2. Retrieve existing topics.
3. Avoid collisions.
4. Register topic.
5. Report chosen topic.

If user supplies a topic:

Use it.

---

# Coordinator Ownership

One coordinator per server.

Startup sequence

* coordinator checks existing owner
* if none exists, claim ownership
* otherwise attach or report conflict

Future versions may support hierarchical coordinators.

Current design must not prevent this.

---

# Failure Behavior

Server stops

Everything disappears.

Workers reconnect.

Coordinator reconnects.

---

Worker crashes

Worker reconnects and onboard again.

---

Coordinator crashes

Workers continue operating.

Messages without listeners are discarded.

---

No subscribers

Messages are discarded.

---

# Logging

Structured logs.

Log

* server startup
* shutdown
* registrations
* coordinator changes
* subscriptions
* publications
* SSE connects
* SSE disconnects
* validation failures

Do not log message bodies by default.

---

# Security

Initial deployment assumptions

* localhost only
* single user
* trusted environment

Validate

* payload sizes
* schemas
* topic names

Do not

* read artifacts
* execute artifacts
* fetch URLs

---

# Acceptance Criteria

The implementation is complete when:

✓ `aboard-server` starts locally.

✓ `aboard-mcp` connects.

✓ `/manage` starts a coordinator.

✓ `/onboard` registers a worker.

✓ Coordinator receives messages from every topic.

✓ Workers only receive messages from subscribed topics.

✓ Messages are ephemeral.

✓ No persistence exists.

✓ Server restart clears all state.

✓ SSE heartbeats keep wait connections alive.

✓ `coordination_wait_for_message` blocks until a message or timeout.

✓ No external database is required.

✓ Installation is possible through npm and execution through `npx`.

---

# Open Questions for Implementation

The coding agent should verify the following against current Claude Code documentation before implementation:

1. How to obtain the native Claude Code conversation/session identifier.
2. Whether that identifier survives `resume`.
3. The preferred packaging format for globally installed Claude Code skills.
4. Recommended MCP TypeScript SDK.
5. Maximum practical timeout for long-running MCP tool calls.
6. Recommended location for the runtime discovery file on macOS, Linux, and Windows.

These are implementation details and should not change the architecture described above.

---

# Design Principles

Every implementation decision should preserve the following principles:

* Simple over comprehensive.
* Ephemeral over persistent.
* Local-first over distributed.
* Messages over workflows.
* Topics over repositories.
* Coordinator interprets semantics.
* Server routes messages.
* MCP adapts transport.
* Workers remain autonomous.
* Users may always interact directly with any worker.
* Scale complexity only when real requirements demand it.
