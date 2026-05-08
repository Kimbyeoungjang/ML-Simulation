# Workload presets

Place JSON files here to make workload presets appear in the UI.

Expected shape:

```json
{
  "kind": "workload",
  "name": "My LLM block",
  "shapes": [
    { "id": "qkv", "model": "my_llm", "opName": "qkv", "m": 128, "n": 12288, "k": 4096, "dtypeBytes": 2, "source": "manual" }
  ]
}
```
