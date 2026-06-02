# Production Handoff Checklist

이 문서는 TileForge를 제출/공유/발표하기 전에 확인할 최종 체크리스트입니다.

## 1. 소스 정리

```bash
npm run clean:generated
npm run check:clean
```

확인할 제외 대상:

- `.env`
- `.env.local`
- `.tileforge/`
- `.tileforge_jobs/`
- `.next/`
- `node_modules/`
- `external/`
- `release/`
- `benchmarks/results/`
- raw log
- `COMPUTE_REPORT.csv`
- `*.vmfb`

## 2. 문서 확인

- `README.md`가 빠른 시작과 문서 목차를 포함하는지
- `docs/README.md`가 최신 문서 index인지
- `docs/architecture.md`가 실제 디렉터리 구조와 맞는지
- `docs/pipeline.md`가 full-layer/tile-policy 분리를 설명하는지
- `docs/user-guide.md`가 dev/production 실행을 모두 설명하는지
- `docs/research-references.md`에 관련 논문/공식 문서가 정리되어 있는지
- `EXTERNAL_TOOLS.md`가 `docs/external-tools.md`를 가리키는지

## 3. 기본 검증

```bash
npm run typecheck
npm run smoke
npm run test:unit
npm run test:extras
```

또는 한 번에:

```bash
npm run test:all
```

## 4. 외부 도구 검증

mock 확인:

```bash
npm run validate:external:mock
```

실제 확인:

```bash
npm run validate:external:required
```

production report에서 SCALE-Sim/IREE 적용을 주장하려면 실제 확인 결과 또는 full-pipeline job artifact를 확보해야 합니다.

## 5. 대표 job artifact 확보

최종 발표/보고서용으로 최소 1개 이상의 대표 full-pipeline job을 완료하고 bundle을 보관합니다.

확인할 파일:

- `report.md`
- `external_validation_report.md` 또는 `validation_report.md`
- `best_tile_policy.csv`
- `scalesim.cfg`
- `topology.csv`
- `layout.csv`
- `generated.mlir`
- `transform.mlir`
- `iree-command.sh`
- `artifact_integrity.json`

## 6. Estimator Suite 사용 시

- dataset sample 수 확인
- `targetScope` 분포 확인
- readiness level 확인
- validation error 확인
- active model path 확인
- out-of-domain warning 여부 확인
- representative 후보 SCALE-Sim 재검증

## 7. production build

```bash
npm run build
```

실행 확인:

```bash
npm run start
npm run worker
```

브라우저에서 다음을 확인합니다.

- 메인 페이지 로딩
- estimate preview 동작
- job queue 표시
- report tab 표시
- system tab status 표시

## 8. release zip 생성

```bash
npm run release:zip
```

zip에 포함되어야 하는 것:

- `src/`
- `scripts/`
- `tests/`
- `docs/`
- `schemas/`
- `examples/`
- `presets/`
- `package.json`, `package-lock.json`
- `README.md`, `EXTERNAL_TOOLS.md`
- `.env.example`

zip에 포함되면 안 되는 것:

- `node_modules/`
- `.env`
- `.tileforge/`
- `.next/`
- `external/`
- local benchmark results

## 9. 발표용 요약 문장

TileForge는 TPU-like systolic array에서 GEMM/Conv workload의 성능을 빠르게 예측하고, SCALE-Sim/IREE로 검증 가능한 artifact를 생성하는 설계 탐색 워크벤치다. 핵심은 full-layer 하드웨어 성능 예측과 tile-policy ranking을 분리하고, 외부 검증 및 Estimator Suite 보정으로 예측 신뢰도를 단계적으로 높이는 것이다.

## 10. 남은 향후 연구

- 실제 TPU/JAX benchmark sample 확장
- IREE runtime benchmark integration 강화
- SRAM bank conflict와 dataflow별 memory model 정밀화
- SCALE-Sim v3 backend 검토
- ONNX/MLIR graph-level fusion 반영
- Estimator Suite dataset 자동 active-learning loop 강화
