import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export interface ResolvedWorkspaceFile {
  absolute: string;
  relative: string;
  exists?: boolean;
}

export class WorkspacePaths {
  public readonly rootDir: string;

  public constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  public async resolveExistingFile(
    requestedPath: string,
  ): Promise<ResolvedWorkspaceFile> {
    const lexicalPath = this.resolveLexicalPath(requestedPath);
    const actualPath = await realpath(lexicalPath.absolute);
    await this.assertRealPathInsideWorkspace(actualPath);
    const fileStat = await stat(actualPath);

    if (!fileStat.isFile()) {
      throw new Error("Path is not a file.");
    }

    return { absolute: actualPath, relative: lexicalPath.relative, exists: true };
  }

  public async resolveWritableFile(
    requestedPath: string,
  ): Promise<ResolvedWorkspaceFile> {
    const file = this.resolveLexicalPath(requestedPath);
    let exists = false;

    try {
      await lstat(file.absolute);
      exists = true;
    } catch (error: unknown) {
      if (!this.isMissingFileError(error)) {
        throw error;
      }
    }

    if (exists) {
      const actualPath = await realpath(file.absolute);
      await this.assertRealPathInsideWorkspace(actualPath);
      const fileStat = await stat(actualPath);

      if (!fileStat.isFile()) {
        throw new Error("Path is not a file.");
      }

      return { absolute: actualPath, relative: file.relative, exists: true };
    }

    await this.assertSafeDirectory(dirname(file.absolute));
    return { ...file, exists: false };
  }

  public async resolveDeletableFile(
    requestedPath: string,
  ): Promise<ResolvedWorkspaceFile> {
    const lexicalPath = this.resolveLexicalPath(requestedPath);
    const lexicalStat = await lstat(lexicalPath.absolute);

    if (lexicalStat.isSymbolicLink()) {
      throw new Error("Deleting symbolic links is not supported.");
    }

    const actualPath = await realpath(lexicalPath.absolute);
    await this.assertRealPathInsideWorkspace(actualPath);
    const fileStat = await stat(actualPath);

    if (!fileStat.isFile()) {
      throw new Error("Only files can be deleted.");
    }

    return { absolute: actualPath, relative: lexicalPath.relative, exists: true };
  }

  public async createParentDirectory(filePath: string): Promise<void> {
    const directory = dirname(filePath);
    await this.assertSafeDirectory(directory);
    await mkdir(directory, { recursive: true });
    const actualDirectory = await realpath(directory);
    await this.assertRealPathInsideWorkspace(actualDirectory, true);
  }

  private resolveLexicalPath(requestedPath: string): ResolvedWorkspaceFile {
    if (!requestedPath.trim()) {
      throw new Error("File path cannot be empty.");
    }

    const absolute = resolve(this.rootDir, requestedPath);
    this.assertContained(this.rootDir, absolute);
    return { absolute, relative: relative(this.rootDir, absolute) };
  }

  private async assertSafeDirectory(directory: string): Promise<void> {
    let existingAncestor = directory;

    while (true) {
      try {
        await lstat(existingAncestor);
        break;
      } catch (error: unknown) {
        if (!this.isMissingFileError(error)) {
          throw error;
        }

        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) {
          throw new Error("Could not resolve a safe parent directory.");
        }
        existingAncestor = parent;
      }
    }

    const actualAncestor = await realpath(existingAncestor);
    await this.assertRealPathInsideWorkspace(actualAncestor, true);
  }

  private async assertRealPathInsideWorkspace(
    target: string,
    allowRoot = false,
  ): Promise<void> {
    const actualRoot = await realpath(this.rootDir);

    if (allowRoot && target === actualRoot) {
      return;
    }

    this.assertContained(actualRoot, target);
  }

  private assertContained(root: string, target: string): void {
    if (target === root || !target.startsWith(`${root}${sep}`)) {
      throw new Error("Path must point to a file inside the workspace.");
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
