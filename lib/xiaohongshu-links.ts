// Use the site's real mobile detail route and native note scheme. A new blank
// window can remain in an installed PWA after Universal Link handoff.
export function xiaohongshuLinks(source: string, id: string) {
  const url = new URL(source);
  if (
    url.origin !== 'https://www.xiaohongshu.com' ||
    !/^[a-f0-9]{24}$/.test(id) ||
    ![
      `/explore/${id}`,
      `/search_result/${id}`,
      `/discovery/item/${id}`,
    ].includes(url.pathname)
  ) {
    throw new Error('小红书帖子链接无效');
  }
  url.pathname = `/explore/${id}`;
  const web = url.href;
  url.pathname = `/discovery/item/${id}`;
  return {
    web,
    mobile: url.href,
    app: `xhsdiscover://item/${id}${url.search}`,
  };
}
