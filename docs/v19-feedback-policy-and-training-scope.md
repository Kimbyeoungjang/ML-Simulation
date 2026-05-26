# v19 Feedback Policy and Training Scope Hardening

TileForge의 검증 루프는 v18에서 `validation_evidence`와 `estimator_suite_feedback.csv`를 만들기 시작했다. 하지만 전체 feedback CSV 안에는 성격이 다른 row가 공존할 수 있다.

- `targetScope=full-layer`, `evidenceReliability=design-target`: SCALE-Sim full topology 결과이며 hardware-design cycle 보정에 사용할 수 있다.
- `targetScope=tile-policy`, `evidenceReliability=ranking-diagnostic`: top-k tile 후보의 ranking/regret 진단용이다.
- `reliability=unmatched`: SCALE-Sim layer 매칭 실패 또는 측정값 누락으로 학습 target으로 쓰면 안 된다.

v19는 이 row들이 조용히 섞여 Estimator Suite에 들어가는 문제를 막는다.

## New artifacts

Full-pipeline과 standalone external validation은 이제 다음 파일을 추가로 만든다.

```text
validation_feedback_policy.md
validation_feedback_policy.json
estimator_suite_feedback_full_layer.csv
estimator_suite_feedback_tile_policy.csv
```

`estimator_suite_feedback.csv`는 전체 audit export로 유지된다. 하드웨어 설계용 Estimator Suite 재학습에는 기본적으로 `estimator_suite_feedback_full_layer.csv`를 사용해야 한다.

## Training policy

Estimator Suite training job은 학습 전에 `targetScope` policy를 적용한다.

- `auto`: 명시적 full-layer row가 있으면 full-layer row만 선택한다.
- `full-layer`: full-layer row만 사용한다.
- `tile-policy`: tile-policy row만 사용한다.
- `all`: 모든 row를 사용한다. 실험용이며 기본값이 아니다.

학습 job은 다음 파일을 남긴다.

```text
estimator-suite-training-policy.md
estimator-suite-training-policy.json
```

이 파일은 입력 sample 수, 실제 선택된 sample 수, 제외된 sample 수, scope 분포, 경고를 기록한다.

## Why this matters

Full-layer target과 tile-policy diagnostic을 섞으면 validation MAPE는 낮아 보여도 실제 하드웨어 설계 성능은 악화될 수 있다. v19의 목적은 정확도를 과장하는 것이 아니라, 어떤 측정값이 어떤 모델에 들어갔는지 추적 가능하게 만드는 것이다.
