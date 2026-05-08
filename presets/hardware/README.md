# Hardware presets

Place JSON files here to make hardware presets appear in the UI.

Expected shape:

```json
{
  "kind": "hardware",
  "name": "My NPU 128x128",
  "hardware": {
    "name": "My NPU 128x128",
    "arrayRows": 128,
    "arrayCols": 128,
    "frequencyMHz": 700,
    "sramKB": 8192,
    "dataflow": "WS",
    "bytesPerElement": 2
  }
}
```
