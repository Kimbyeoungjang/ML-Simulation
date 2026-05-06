# Validation Strategy

TileForge uses four levels of validation:

- **Input validation** with shared Zod schemas in `src/lib/validation.ts`.
- **Unit tests** for estimator, calibration, parsing, and math helpers.
- **Golden tests** that check artifact contracts such as policy CSV headers and required report sections.
- **Integration tests** that create a job, run the worker, and verify artifacts.

Recommended numerical acceptance criteria:

- SCALE-Sim cycle MAPE <= 25% before calibration.
- Top-3 tile contains SCALE-Sim best tile >= 85% of validation samples.
- Calibration should reduce median absolute error on a held-out set.
