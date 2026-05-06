import type { JobRecord } from "@/types/job";
export interface BackendRunner { name: string; prepare(job: JobRecord): Promise<void>; run(job: JobRecord): Promise<void>; parse(job: JobRecord): Promise<Record<string, unknown>>; summarize(parsed: Record<string, unknown>): string; }
export class PlaceholderRunner implements BackendRunner { constructor(public name: string) {} async prepare() {} async run() {} async parse(){ return { placeholder: true, name: this.name }; } summarize(){ return `${this.name} runner placeholder executed. Configure an external command to enable real execution.`; } }
export const runners = { scalesim: new PlaceholderRunner("SCALE-Sim"), timeloop: new PlaceholderRunner("Timeloop"), maestro: new PlaceholderRunner("MAESTRO"), iree: new PlaceholderRunner("IREE") };
