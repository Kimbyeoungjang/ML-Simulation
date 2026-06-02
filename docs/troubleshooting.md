# Troubleshooting

## `npm run dev`는 켜졌는데 job이 완료되지 않음

확인 순서:

1. 작업 큐 탭에서 worker log를 확인합니다.
2. worker 프로세스가 실제로 실행 중인지 확인합니다.
3. production 모드라면 `npm run start`와 별도로 `npm run worker`가 실행 중이어야 합니다.
4. `.env`의 `TILEFORGE_MAX_PARALLEL_JOBS`가 0 또는 잘못된 값이 아닌지 확인합니다.
5. 오래된 running job은 `npm run jobs:recover` 또는 `npm run jobs:clean`으로 정리합니다.

## SCALE-Sim stage가 skipped

원인:

- `TILEFORGE_SCALE_SIM_CMD`가 비어 있음
- `.env` 수정 후 서버/worker를 재시작하지 않음
- setup script가 fork 설치에 실패함

해결:

```bash
npm run setup:env
npm run doctor:external
npm run validate:external:required
```

## SCALE-Sim `No section: layout`

오래된 artifact 또는 fork와 cfg format 불일치일 수 있습니다. 최신 TileForge는 layout section과 `layout.csv`를 생성합니다.

해결:

1. 새 full-pipeline job을 실행합니다.
2. `scalesim.cfg`에 `[layout]` 관련 항목이 있는지 확인합니다.
3. `layout.csv`가 artifact로 생성됐는지 확인합니다.
4. fork가 프로젝트에서 사용한 fork인지 확인합니다.

## SCALE-Sim bandwidth/bank 값 오류

일부 SCALE-Sim 설정은 정수 값을 요구합니다. 최신 TileForge는 bandwidth/bank 값을 정수화해 내보냅니다. 오래된 job artifact를 재사용하지 말고 새 job을 실행하세요.

## IREE compile이 skipped

원인:

- `TILEFORGE_IREE_COMPILE_CMD` 미설정
- IREE package 미설치
- `.env` 재시작 누락

해결:

```bash
npm run setup:iree
npm run setup:env
npm run doctor:external
```

권장 값:

```dotenv
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
```

## IREE VMFB가 0 byte

1. IREE stderr를 확인합니다.
2. `generated.mlir`이 비어 있지 않은지 확인합니다.
3. compile command가 `iree.compiler.tools.scripts.iree_compile`인지 확인합니다.
4. MLIR 문법 오류가 있으면 `generated.mlir`과 `transform.mlir`을 artifact로 내려받아 따로 실행합니다.

## 보고서가 대기 중으로 보임

- preview report를 보고 있을 수 있습니다.
- 보고서 탭에서 completed job의 `report.md`를 직접 선택하세요.
- 여러 job을 동시에 실행한 경우 원하는 job id를 확인하세요.

## 그래프에 후보가 너무 많아 느림

- tile 후보 수를 줄입니다.
- `TILEFORGE_MAX_CANDIDATES`와 `TILEFORGE_HEATMAP_MAX_POINTS`를 조정합니다.
- 먼저 작은 sweep으로 경향을 본 뒤 후보를 좁혀 full-pipeline을 실행합니다.

## Estimator Suite가 blocked

확인 항목:

- sample 수가 충분한지
- `targetScope`가 섞이지 않았는지
- full-layer와 tile-policy를 같은 model로 학습하려 하지 않았는지
- dataflow/array/workload coverage가 너무 좁지 않은지
- validation error가 너무 크지 않은지

해결:

```bash
# 완료 job에서 sample 재수집
# UI에서 collect-jobs 또는 API action 사용
# 부족한 영역은 plan-and-queue로 추가 검증
```

## Windows에서 Python을 못 찾음

```powershell
$env:TILEFORGE_PYTHON="C:\Users\사용자\AppData\Local\Programs\Python\Python312\python.exe"
npm run setup:env
```

또는 `.env`에 직접 command를 씁니다.

```dotenv
TILEFORGE_SCALE_SIM_CMD="C:\\Path\\To\\python.exe -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="C:\\Path\\To\\python.exe -m iree.compiler.tools.scripts.iree_compile"
```

## job 목록이 느림

대량 job/artifact가 있을 때는 job 목록이 전체 `job.json`, log, artifact 배열을 직접 렌더링하지 않아야 합니다. 최신 UI는 `/api/jobs`에서 경량 summary만 받고, artifact 목록은 선택한 job을 열 때 `/api/jobs/:id/artifacts?limit=200&page=1`처럼 페이지 단위로 가져옵니다.

권장 `.env`:

```dotenv
TILEFORGE_SQLITE_PRIMARY="1"
TILEFORGE_JOBS_DASHBOARD_ARTIFACTS="0"
TILEFORGE_JOBS_ARTIFACT_PREVIEW_LIMIT="8"
TILEFORGE_JOBS_API_CACHE_MS="2000"
TILEFORGE_JOBS_FALLBACK_CACHE_MS="10000"
TILEFORGE_STATUS_SCAN_STORAGE="0"
```

SQLite native module을 사용할 수 없는 환경에서는 `job.summary.json` fallback이 사용됩니다. 기존 job은 첫 조회 때 summary가 생성되므로 첫 목록 조회만 상대적으로 느릴 수 있고, 이후 조회는 작은 summary 파일을 읽습니다.

정리:

```bash
npm run jobs:stats
npm run jobs:clean
npm run cache:clean
```

## release zip에 불필요한 파일이 들어감

```bash
npm run clean:generated
npm run check:clean
npm run release:zip
```

수동으로 확인할 제외 대상:

- `.env`
- `.tileforge/`
- `.tileforge_jobs/`
- `.next/`
- `node_modules/`
- `external/`
- `release/`
- `benchmarks/results/`
- `COMPUTE_REPORT.csv`
- `*.vmfb`
- `*.log`

## typecheck는 통과하지만 build가 오래 걸림

Next.js build의 trace/static generation 단계가 환경에 따라 오래 걸릴 수 있습니다. production 제출 전에는 로컬 환경에서 다음을 권장합니다.

```bash
npm run typecheck
npm run test:unit
npm run build
```

샌드박스에서 timeout이 나면 compile 단계 로그와 로컬 build 결과를 구분해 기록하세요.
