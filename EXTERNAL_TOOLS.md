# 외부 도구 설치 가이드

상세 문서는 [`docs/external-tools.md`](docs/external-tools.md)를 기준으로 관리합니다. 이 파일은 루트에서 빠르게 찾기 위한 요약입니다.

## 빠른 설치

```bash
npm run setup:external
npm run doctor:external
npm run validate:external:required
```

## SCALE-Sim

기본 fork:

```text
https://github.com/Kimbyeoungjang/SCALE-Sim
```

설치:

```bash
npm run setup:scalesim -- --force
```

권장 `.env`:

```dotenv
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
```

macOS/Linux에서는 `python3 -m scalesim.scale`을 사용할 수 있습니다.

## IREE

설치:

```bash
npm run setup:iree
```

내부적으로 `iree-base-compiler`, `iree-base-runtime`을 설치합니다.

권장 `.env`:

```dotenv
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
```

## Python 탐색 순서

Windows:

```text
py -3 → python → python3
```

macOS/Linux:

```text
python3 → python → py -3
```

직접 지정:

```powershell
$env:TILEFORGE_PYTHON="C:\Users\사용자\AppData\Local\Programs\Python\Python312\python.exe"
npm run setup:external
```

## Mock 검증

외부 도구가 설치되지 않은 환경에서 integration만 확인할 때:

```bash
npm run validate:external:mock
```

## 실제 검증

production report에서 외부 도구 검증을 주장하려면 mock이 아니라 실제 required 검증을 사용합니다.

```bash
npm run validate:external:required
```
