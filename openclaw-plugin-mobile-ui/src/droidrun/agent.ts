import { DroidrunExecutor } from "./executor";

export class DroidrunAgent {
  private exec = new DroidrunExecutor();

  // v1：占位实现。后续替换为真实 droidrun agent API
  async runTask(task: string) {
    const health = await this.exec.health();
    return {
      ok: true,
      data: {
        mode: "agent-placeholder",
        task,
        health,
      },
    };
  }
}