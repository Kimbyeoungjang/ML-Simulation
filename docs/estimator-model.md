# Estimator Model

The estimator is intentionally lightweight. It ranks tile candidates using:

- padded operation count
- active systolic array rows/columns
- boundary padding ratio
- dataflow factor
- local SRAM footprint
- calibration factor, when supplied

Use SCALE-Sim or IREE results to validate and calibrate the analytic estimator before making hardware claims.
