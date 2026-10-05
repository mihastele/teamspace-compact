export interface StorageFile {
    getSignedUrl(options: {
        version: "v4";
        action: "read" | "write";
        contentType?: string;
        extensionHeaders?: Record<string, string>;
        expires: number;
        responseDisposition?: string;
    }): Promise<[
        string
    ]>;
    getMetadata(): Promise<[
        {
            size?: string | number;
            contentType?: string;
            generation?: string | number;
        }
    ]>;
    download(): Promise<[
        Buffer
    ]>;
    delete(options: {
        ignoreNotFound: boolean;
    }): Promise<unknown>;
    save(bytes: Buffer, options: {
        resumable: false;
        contentType: string;
        preconditionOpts: {
            ifGenerationMatch: 0;
        };
        metadata: {
            cacheControl: string;
        };
    }): Promise<unknown>;
}
export interface StorageBucket {
    file(path: string, options?: {
        generation: number | string;
    }): StorageFile;
}
export interface StoragePort {
    bucket(name?: string): StorageBucket;
}
