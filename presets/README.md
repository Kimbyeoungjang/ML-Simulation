# TileForge Presets

프리셋은 반복 실험을 빠르게 시작하기 위한 입력 묶음입니다. hardware, workload shapes, tile candidates, objective, SCALE-Sim option, selected dataflow를 저장할 수 있습니다.

## 디렉터리

| 경로 | 의미 |
|---|---|
| `presets/default/` | 레포지토리에 포함되는 기본 프리셋 |
| `presets/hardware/` | 하드웨어 중심 프리셋 |
| `presets/workload/` | workload/shape 중심 프리셋 |
| `presets/estimator/` | Estimator Suite 실험 프리셋 |
| `presets/user/` | UI에서 저장한 사용자 프리셋, release zip에는 포함하지 않는 것을 권장 |

## 사용 원칙

- 발표/제출에 필요한 기본값은 `default/` 또는 주제별 디렉터리에 둡니다.
- 개인 실험용 값은 `user/`에 저장합니다.
- 프리셋에는 비밀정보나 로컬 절대경로를 넣지 않습니다.
- 외부 도구 경로는 프리셋이 아니라 `.env`에서 관리합니다.

## 프리셋에 포함할 수 있는 항목

- hardware config
- GEMM/Conv workload shape
- tileM/tileN/tileK 후보
- objective
- SCALE-Sim bandwidth/layout/bank option
- selected dataflows
- notes

## production 추천

최종 제출용 프리셋은 다음 이름 규칙을 권장합니다.

```text
<hardware>-<workload>-<purpose>.json
```

예시:

```text
tpuv2-like-vit-s-hardware-design.json
tpuv2-like-resnet-dataflow-compare.json
```
