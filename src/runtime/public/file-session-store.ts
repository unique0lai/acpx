import fs from "node:fs/promises";
import path from "node:path";
import { assertPersistedKeyPolicy } from "../../persisted-key-policy.js";
import { parseSessionRecord } from "../../session/persistence/parse.js";
import { serializeSessionRecordForDisk } from "../../session/persistence/serialize.js";
import type { AcpFileSessionStoreOptions, AcpSessionRecord, AcpSessionStore } from "./contract.js";

function safeSessionId(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

class FileSessionStore implements AcpSessionStore {
  constructor(private readonly stateDir: string) {}

  private get sessionDir(): string {
    return path.join(this.stateDir, "sessions");
  }

  private filePath(sessionId: string): string {
    return path.join(this.sessionDir, `${safeSessionId(sessionId)}.json`);
  }

  private eventLogPath(sessionId: string): string {
    return path.join(this.sessionDir, `${safeSessionId(sessionId)}.stream.ndjson`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
  }

  async load(sessionId: string): Promise<AcpSessionRecord | undefined> {
    await this.ensureDir();
    let payload: string;
    try {
      payload = await fs.readFile(this.filePath(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return undefined;
    }
    const record = parseSessionRecord(parsed) ?? undefined;
    if (record) {
      record.eventLog.active_path = this.eventLogPath(record.acpxRecordId);
    }
    return record;
  }

  async save(record: AcpSessionRecord): Promise<void> {
    await this.ensureDir();
    record.eventLog.active_path = this.eventLogPath(record.acpxRecordId);
    const persisted = serializeSessionRecordForDisk(record);
    assertPersistedKeyPolicy(persisted);

    const file = this.filePath(record.acpxRecordId);
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(persisted, null, 2);
    await fs.writeFile(tempFile, `${payload}\n`, "utf8");
    await fs.rename(tempFile, file);
  }
}

export function createFileSessionStore(options: AcpFileSessionStoreOptions): AcpSessionStore {
  return new FileSessionStore(path.resolve(options.stateDir));
}
