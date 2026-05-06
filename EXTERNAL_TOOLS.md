# 외부 도구 설치 가이드

TileForge는 자체 estimator만으로도 동작하지만, 실제 검증을 위해서는 SCALE-Sim과 IREE를 함께 사용할 수 있습니다.

## 1. 한 번에 설치

```bash
npm run setup:external
```

이 명령은 다음 두 명령을 순서대로 실행합니다.

```bash
npm run setup:scalesim
npm run setup:iree
```

## 2. SCALE-Sim 설치

이 레포는 공식 SCALE-Sim 대신 사용자가 수정한 fork를 기본으로 사용합니다.

```bash
npm run setup:scalesim -- --force
```

기본 repo:

```text
https://github.com/Kimbyeoungjang/SCALE-Sim
```

설치 스크립트는 `external/SCALE-Sim`에 fork를 clone하고 editable install을 수행합니다. Windows에서는 `python3` 명령이 없어도 `py -3`, `python`, `python3` 순서로 자동 탐색합니다.

다른 fork를 쓰고 싶으면:

```bash
TILEFORGE_SCALE_SIM_REPO="https://github.com/<owner>/SCALE-Sim" npm run setup:scalesim -- --force
```

Windows PowerShell에서는:

```powershell
$env:TILEFORGE_SCALE_SIM_REPO="https://github.com/<owner>/SCALE-Sim"
npm run setup:scalesim -- --force
```

## 3. IREE 설치

```bash
npm run setup:iree
```

내부적으로 다음 패키지를 설치합니다.

```text
iree-base-compiler
iree-base-runtime
```

`--force` 또는 `--upgrade`를 붙이면 기존 설치본을 업그레이드합니다.

```bash
npm run setup:iree -- --upgrade
```

## 4. Python 명령 탐색 순서

설치 스크립트는 플랫폼에 따라 Python을 자동 탐색합니다.

Windows:

```text
py -3 → python → python3
```

macOS/Linux:

```text
python3 → python → py -3
```

탐색이 실패하면 `TILEFORGE_PYTHON`으로 직접 지정할 수 있습니다.

```powershell
$env:TILEFORGE_PYTHON="C:\Users\사용자명\AppData\Local\Programs\Python\Python312\python.exe"
npm run setup:external
```

## 5. 설치 확인

```bash
npm run doctor:external -- --require-external
```

성공하면 SCALE-Sim과 IREE compiler가 모두 감지됩니다.

## 6. 직접 명령 지정

자동 탐색이 마음에 들지 않으면 환경 변수로 고정할 수 있습니다.

```bash
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale" \
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.core" \
npm run validate:external -- --require-external --timeout-ms 180000
```

PowerShell:

```powershell
$env:TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
$env:TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.core"
npm run validate:external -- --require-external --timeout-ms 180000
```

## 7. 참고

예전 PyPI 패키지명인 `iree-compiler`, `iree-runtime`은 더 이상 권장하지 않습니다. 이 레포는 `iree-base-compiler`, `iree-base-runtime`을 사용합니다.
