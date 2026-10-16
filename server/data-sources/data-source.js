// DataSource contract. The UI and services only talk to this interface, so the mock
// implementation can be swapped for GA4 / App Store Connect / Google Play connectors
// (which would write into metric_daily or query the APIs directly) without UI changes.

export class DataSource {
  /**
   * Daily values of one metric for one platform.
   * @param {number} projectId
   * @param {string} metricKey  e.g. "revenue" (USD), "downloads", "ch_installs:facebook"
   * @param {string} dateFrom   "YYYY-MM-DD" inclusive
   * @param {string} dateTo     "YYYY-MM-DD" inclusive
   * @param {'ios'|'android'|'web'|'all'} platform
   * @returns {Promise<{date:string, value:number}[]>} ascending by date, missing days omitted
   */
  // eslint-disable-next-line no-unused-vars
  async getMetric(projectId, metricKey, dateFrom, dateTo, platform) {
    throw new Error('not implemented');
  }

  /** Latest date for which every source of the project has complete data. */
  // eslint-disable-next-line no-unused-vars
  async getLatestCompleteDate(projectId) {
    throw new Error('not implemented');
  }

  /** Blog posts tracked for the project: [{ slug, title }]. */
  // eslint-disable-next-line no-unused-vars
  async listBlogPosts(projectId) {
    throw new Error('not implemented');
  }
}
