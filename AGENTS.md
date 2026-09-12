# Coding preferences

- Strongly prefer pure functions and immutable data transformations. Return new values instead of mutating inputs, shared state, or local accumulators.
- Prefer declarative collection methods such as `map`, `filter`, and `flatMap` over `for` loops where practical; a `reduce` callback should also avoid mutating its accumulator.
- Keep side effects at explicit boundaries so the core logic is easy to reason about.
