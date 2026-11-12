# DS Super-agent Host

The copied `ds-superagent-ui` chat surface still uses the existing `/api/bot`
protocol. This package mounts the DS Bot Host server for that protocol without
loading the DS Bot client bundle, and sets `executionAdapterRequired: true` so
the Host uses the Super-agent Engine or fails.

It is a bridge for the copied UI. The next step is to replace this Host with a
narrow Super-agent protocol adapter and remove the old team server.
