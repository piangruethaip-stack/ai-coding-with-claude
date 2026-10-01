---
name: security-baseline
description: Security rules for this codebase. Use when designing, building or reviewing any feature that handles user input, reports from the public, or personal data.
---

# Security baseline

- Validate every input at the boundary (API handler). Never trust the client.
- Measurements are integers in a stated unit (depth in cm). Never floats.
- Anything the public can submit must be rate-limited per IP.
- Never log or return personal data (phone, name, exact address). Log IDs instead.
- Anything shown to the public must say it is user-reported, not an official warning.
