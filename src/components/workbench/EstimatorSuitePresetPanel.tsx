"use client";

type EstimatorPreset = {
  id: string;
  name: string;
  description: string;
  source?: string;
};

type Props = {
  presets: EstimatorPreset[];
  selectedPresetId?: string;
  setSelectedPresetId?: (id: string) => void;
  presetName?: string;
  setPresetName?: (name: string) => void;
  busy: boolean;
  onApplyPreset?: (id: string) => void;
  onSavePreset?: () => void;
  onDeletePreset?: (id: string) => void;
};

export function EstimatorSuitePresetPanel({
  presets,
  selectedPresetId,
  setSelectedPresetId,
  presetName,
  setPresetName,
  busy,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: Props) {
  const selected = presets.find((preset) => preset.id === selectedPresetId);
  return (
    <section
      className="suite-section"
      title="자주 쓰는 표본 계획과 학습 설정을 한 번에 적용합니다."
    >
      <h4>0. Estimator 프리셋</h4>
      <p className="small">
        Smoke/512개 테스트/4096개 본 실험/대량 CSV 학습 설정을 버튼 하나로
        적용합니다. 프리셋은 표본 계획 값과 Tree/Neural 학습 설정을 함께
        바꿉니다.
      </p>
      <div className="row2">
        <label className="mini-field">
          <span>프리셋</span>
          <select
            value={selectedPresetId ?? ""}
            onChange={(e) => setSelectedPresetId?.(e.target.value)}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.source === "builtin" ? "기본" : "사용자"} · {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mini-field">
          <span>저장 이름</span>
          <input
            value={presetName ?? ""}
            onChange={(e) => setPresetName?.(e.target.value)}
            placeholder="예: vit_s_4096_train"
          />
        </label>
      </div>
      <div className="estimator-actions">
        <button
          className="secondary"
          title="선택한 프리셋의 표본 계획과 학습 설정을 현재 화면에 적용합니다."
          onClick={() => selectedPresetId && onApplyPreset?.(selectedPresetId)}
          disabled={busy || !selectedPresetId}
        >
          프리셋 적용
        </button>
        <button className="secondary" title="현재 표본 계획과 학습 설정을 사용자 프리셋으로 저장합니다." onClick={onSavePreset} disabled={busy}>
          현재 설정을 사용자 프리셋으로 저장
        </button>
        <button
          className="secondary"
          title="선택한 사용자 Estimator 프리셋을 삭제합니다. 기본 프리셋은 삭제할 수 없습니다."
          onClick={() => selectedPresetId && onDeletePreset?.(selectedPresetId)}
          disabled={busy || !selectedPresetId || selected?.source === "builtin"}
        >
          선택 사용자 프리셋 삭제
        </button>
      </div>
      {selected?.description && <p className="small good">{selected.description}</p>}
    </section>
  );
}
