# User Guide

## 1. 설치

```bash
npm install
npm run setup:env
npm run doctor
```

외부 검증까지 사용할 경우:

```bash
npm run setup:external
npm run doctor:external
npm run validate:external:required
```

SCALE-Sim/IREE 없이도 estimator preview와 기본 UI는 사용할 수 있습니다.

## 2. 개발 모드 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 이 명령은 웹 서버와 worker를 동시에 실행합니다.

## 3. production 모드 실행

```bash
npm run build
npm run start
```

별도 터미널에서 worker를 실행합니다.

```bash
npm run worker
```

full-pipeline job은 worker가 처리하므로 production에서도 worker가 필요합니다.

## 4. 하드웨어 입력

하드웨어 탭에서 다음 값을 설정합니다.

| 항목 | 의미 |
|---|---|
| Array rows/cols | systolic array의 PE grid 크기 |
| Frequency MHz | cycle을 시간으로 바꿀 때 쓰는 clock |
| SRAM KB | tile scratch와 layer footprint가 들어갈 온칩 메모리 budget |
| Dataflow | WS/OS/IS 중 데이터 재사용 기준 |
| Bytes/element | fp16이면 2, int8이면 1 등 dtype 크기 |
| Memory bandwidth | roofline/memory-bound 판단에 쓰는 대역폭 |
| Energy parameter | energy/EDP 추정에 쓰는 단위 에너지 |

기본 preset은 `TPUv2-like 128x128`, 700 MHz, 8192 KiB SRAM, WS, 2 bytes/element입니다.

## 5. 타일링 입력

타일링 탭에서 `tileM`, `tileN`, `tileK` 후보 배열을 설정합니다.

예시:

```text
tileM = 16, 32, 64, 128
tileN = 32, 64, 128, 256
tileK = 32, 64, 128, 256
```

candidate 수가 너무 커지면 UI/worker가 느려질 수 있으므로 production 발표용 실험에서는 먼저 작은 sweep으로 확인하고, 후보를 좁힌 뒤 full-pipeline을 실행하는 것을 권장합니다.

## 6. 워크로드 입력

지원 방식:

- 직접 GEMM 입력
- CSV import
- ONNX/JSON shape summary import
- Conv2D → im2col GEMM 변환
- preset workload

GEMM 정의:

```text
C[M x N] = A[M x K] × B[K x N]
```

Conv2D 변환:

```text
M = batch × outputH × outputW
N = outputC
K = inputC × kernelH × kernelW
```

## 7. 빠른 preview

실행 탭에서 server estimate를 실행하면 외부 도구 없이 즉시 다음을 확인할 수 있습니다.

- 추천 tile
- cycle/time/utilization/padding/SRAM
- bottleneck op
- roofline bound
- energy estimate
- report preview
- SCALE-Sim/IREE artifact preview

preview는 빠른 설계 방향 확인용입니다. 외부 검증이 필요한 결론은 full-pipeline으로 확인하세요.

## 8. full-pipeline 실행

실행 탭에서 full-pipeline job을 queue에 넣습니다. 작업 큐 탭에서 다음을 확인합니다.

- queued/running/completed/failed 상태
- stage별 progress
- worker log
- SCALE-Sim stdout/stderr
- IREE stdout/stderr
- 생성 artifact 목록

여러 dataflow를 선택하면 dataflow별 job이 생성되어 비교할 수 있습니다.

## 9. 보고서 해석

보고서에서 먼저 확인할 항목은 다음입니다.

1. **외부 도구 반영 상태**: SCALE-Sim/IREE가 실제로 적용됐는지 확인합니다.
2. **예측 vs 검증 비교**: TileForge full-layer cycle과 SCALE-Sim full topology cycle의 비율을 확인합니다.
3. **tile-policy 표**: tile 후보 ranking은 full-layer validation과 별개로 봅니다.
4. **memory traffic**: SRAM/DRAM 접근량이 병목 설명과 일관되는지 봅니다.
5. **warnings**: SRAM overflow, low utilization, out-of-domain prediction을 확인합니다.

## 10. 그래프 탭

그래프 탭은 다음 목적에 사용합니다.

- Top-K tile의 cycle/utilization/SRAM 비교
- 모든 tile 후보 분포 확인
- full-layer SCALE-Sim 대비 TileForge 예측 비교
- dataflow별 성능 비교
- design-space sweet spot 확인

Design-space 그래프는 하드웨어 축과 workload 축을 구분해 score를 계산합니다. workload가 작아져 cycle이 줄어드는 착시를 줄이기 위해 `ops/cycle` 정규화를 사용합니다.

## 11. Estimator Suite 사용

1. full-pipeline job을 여러 개 완료합니다.
2. Estimator Suite 탭에서 `collect-jobs`로 dataset을 만듭니다.
3. `scope-pipeline` 또는 `dataset-and-train`으로 full-layer/tile-policy scope를 분리해 학습합니다.
4. readiness가 `ready` 또는 허용 가능한 `caution`인지 확인합니다.
5. active model로 적용합니다.
6. 이후 estimate/design-space 결과에 correction과 confidence가 반영됩니다.

sample이 너무 적으면 model training은 skip되거나 blocked/caution으로 표시됩니다.

## 12. 프로젝트 저장/불러오기

프로젝트 파일은 `project.json` 구조로 저장됩니다. 포함 항목:

- hardware
- shapes
- candidates
- objective
- scaleSim options
- notes

발표/제출용으로는 job artifact bundle과 project file을 함께 보관하면 재현성이 좋아집니다.

## 13. 정리와 배포

로컬 생성물을 정리합니다.

```bash
npm run clean:generated
npm run check:clean
```

릴리스 zip을 만듭니다.

```bash
npm run release:zip
```

`.env`, `.tileforge`, `.next`, `node_modules`, `external`, `release`, `benchmarks/results`는 소스 배포본에 포함하지 않습니다.
