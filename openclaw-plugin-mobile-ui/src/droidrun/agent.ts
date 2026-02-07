import { DroidrunExecutor } from "./executor";

export class DroidrunAgent {
  private exec = new DroidrunExecutor();

  /**
   * TODO: 未来替换为真正的 droidrun agent 规划执行
   * 现在先给一个可用的占位：返回 health
   */
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