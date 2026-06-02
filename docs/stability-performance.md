# Stability and Performance Notes

이 문서는 production에 가까워진 TileForge의 운영 안정성, 대량 job 처리, artifact 관리 방식을 정리합니다.

## Job store

TileForge는 job metadata를 SQLite 또는 file-backed store로 관리합니다.

- SQLite 사용 가능 시 job/status/artifact metadata를 빠르게 조회합니다.
- SQLite가 불가능하면 file fallback으로 동작합니다.
- job stage marker와 metadata를 함께 기록해 중간 실패 원인 분석이 가능합니다.
- stale running job은 recovery script로 복구할 수 있습니다.

관련 명령:

```bash
npm run jobs:stats
npm run jobs:recover
npm run jobs:clean
```

## Atomic artifact write

artifact는 임시 파일에 쓴 뒤 atomic rename으로 최종 위치에 둡니다. 이렇게 하면 worker가 중간에 죽어도 깨진 artifact가 최종 파일로 남을 가능성을 줄입니다.

artifact 저장 후에는 `artifact_integrity.json`을 생성합니다.

## External command safety

외부 명령 실행 정책:

- shell string 직접 실행을 피하고 spawn 기반으로 실행
- allowlisted environment 전달
- job-local working directory 사용
- stdout/stderr 크기 제한
- timeout 시 process tree 종료
- raw log와 exit code 기록
- path traversal 방지

## Parallel jobs

병렬도는 `.env` 또는 시스템 탭에서 설정합니다.

```dotenv
TILEFORGE_MAX_PARALLEL_JOBS="6"
TILEFORGE_MAX_PARALLEL_JOBS_CAP="8"
```

권장:

- 노트북/소형 환경: 2~4
- 데스크톱 고성능 환경: 4~8
- SCALE-Sim/IREE가 메모리를 많이 쓰는 경우 병렬도를 줄입니다.

## Cache

Estimator 결과는 cache에 저장되어 같은 request의 반복 평가를 줄입니다.

```dotenv
TILEFORGE_DISABLE_CACHE="0"
TILEFORGE_CACHE_DIR=".tileforge/cache"
```

정리:

```bash
npm run cache:stats
npm run cache:clean
```

## Large queue UI guardrails

job이 수백~수천 개로 늘면 dashboard에서 artifact를 eager loading하지 않는 것이 좋습니다.

```dotenv
TILEFORGE_JOBS_DASHBOARD_ARTIFACTS="0"
TILEFORGE_JOBS_API_CACHE_MS="2000"
TILEFORGE_STATUS_COUNTS_CACHE_MS="5000"
TILEFORGE_STATUS_SIZE_CACHE_MS="60000"
TILEFORGE_STATUS_SCAN_STORAGE="0"
```

## Candidate guardrails

후보 수가 너무 많으면 estimator와 heatmap이 느려집니다.

```dotenv
TILEFORGE_MAX_CANDIDATES="20000"
TILEFORGE_HEATMAP_MAX_POINTS="5000"
TILEFORGE_MAX_PREDICTION_ARTIFACT_ROWS="20000"
```

대규모 sweep은 Estimator Suite sampling plan으로 나누어 실행하는 것이 안정적입니다.

## Memory-heavy training

Estimator Suite 학습은 큰 CSV와 model artifact를 만들 수 있습니다.

```dotenv
TILEFORGE_TRAIN_HEAP_MB="12288"
```

Node heap 부족이 보이면 heap 값을 늘리거나 dataset을 scope별로 나눠 학습합니다.

## Production cleanup

release 전 local artifact를 제거합니다.

```bash
npm run clean:generated
npm run check:clean
```

`release:zip`은 `.env`, `.tileforge`, `node_modules`, build cache, benchmark results를 제외합니다.

## 성능 최적화 방향

이미 반영된 방향:

- candidate pre-pruning
- Top-K streaming
- shape-level cache reuse
- design-space artifact generation skip
- dashboard artifact eager loading off
- status count/cache 적용
- SQLite metadata fast path

추가 개선 후보:

- worker pool별 external tool resource quota
- SCALE-Sim result parser streaming화
- Estimator Suite dataset incremental append
- repeated topology/layout artifact de-duplication
- design-space active validation batch scheduling
