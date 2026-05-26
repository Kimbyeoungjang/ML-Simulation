"use client";

import { useState } from "react";

export function useEnvSettings() {
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envMessage, setEnvMessage] = useState("");

  async function refreshEnvSettings() {
    try {
      const r = await fetch("/api/env");
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "env read failed");
      setEnvValues(j.values ?? {});
      setEnvMessage("설정을 다시 읽었습니다.");
    } catch (error: any) {
      setEnvMessage(`설정 읽기 실패: ${error?.message ?? error}`);
    }
  }

  async function saveEnvSettings() {
    try {
      const r = await fetch("/api/env", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: envValues }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "env save failed");
      setEnvValues(j.values ?? envValues);
      setEnvMessage(".env를 저장했습니다. 실행 중인 작업에는 다음 실행부터 반영됩니다.");
    } catch (error: any) {
      setEnvMessage(`설정 저장 실패: ${error?.message ?? error}`);
    }
  }

  return { envValues, setEnvValues, envMessage, refreshEnvSettings, saveEnvSettings };
}
