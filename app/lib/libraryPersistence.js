// 产业目录是用户维护的长期定义；保存时只做深拷贝，不根据当前成分股反向裁剪目录。
export function taxonomyForPersistence(taxonomy) {
  return structuredClone(taxonomy);
}
