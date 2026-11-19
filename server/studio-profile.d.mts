/**
 * `studio-profile.mjs` 的最小类型声明。
 *
 * 那个模块是给 `server/index.mjs`（纯 JS）用的 ESM，没有类型产物；
 * TS 侧目前只需要从它派生路由 id。多导出一个函数就多一处要维护的签名，
 * 所以这里只声明实际被 TS 引用的成员。
 */
export declare function routeIdForProvider(providerId: string): string
