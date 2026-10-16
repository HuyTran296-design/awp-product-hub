// MockDataSource: serves the generated sample data stored in metric_daily.

import { DataSource } from './data-source.js';
import { generateProjectData, MOCK_DATA_VERSION } from './mock-data-generator.js';
import { yesterday } from '../clock.js';
import { getAppSetting, setAppSetting, tx } from '../database.js';

export class MockDataSource extends DataSource {
  constructor(db) {
    super();
    this.db = db;
    this.stmtMetric = db.prepare(`SELECT date, value FROM metric_daily
      WHERE project_id = ? AND metric_key = ? AND platform = ? AND date BETWEEN ? AND ? ORDER BY date`);
    this.stmtLatest = db.prepare('SELECT MAX(date) AS d FROM metric_daily WHERE project_id = ?');
  }

  async getMetric(projectId, metricKey, dateFrom, dateTo, platform) {
    return this.stmtMetric.all(projectId, metricKey, platform, dateFrom, dateTo);
  }

  async getLatestCompleteDate(projectId) {
    return this.stmtLatest.get(projectId)?.d ?? null;
  }

  async listBlogPosts(projectId) {
    return this.db.prepare('SELECT slug, title FROM blog_posts WHERE project_id = ? ORDER BY rowid').all(projectId);
  }

  /** (Re)generate sample data for one project, ending at endDate (default: yesterday). */
  generateFor(project, endDate = yesterday()) {
    if (project.sampleData === false) return; // e.g. a parent project without own connections
    const { rows, posts } = generateProjectData(project.slug, endDate, undefined, { productType: project.productType });
    tx(this.db, () => {
      this.db.prepare('DELETE FROM metric_daily WHERE project_id = ?').run(project.id);
      this.db.prepare('DELETE FROM blog_posts WHERE project_id = ?').run(project.id);
      const ins = this.db.prepare('INSERT INTO metric_daily (project_id, date, metric_key, platform, value) VALUES (?, ?, ?, ?, ?)');
      for (const r of rows) ins.run(project.id, r.date, r.metricKey, r.platform, r.value);
      const insPost = this.db.prepare('INSERT INTO blog_posts (project_id, slug, title) VALUES (?, ?, ?)');
      for (const p of posts) insPost.run(project.id, p.slug, p.title);
    });
  }

  /** Sample data is anchored to "yesterday"; regenerate when the stored data is stale. */
  ensureFresh(projects, endDate = yesterday()) {
    let regenerated = 0;
    const outdated = getAppSetting(this.db, 'mock_data_version', 1) !== MOCK_DATA_VERSION;
    for (const p of projects.filter((x) => x.sampleData !== false)) {
      if (outdated || this.stmtLatest.get(p.id)?.d !== endDate) {
        this.generateFor(p, endDate);
        regenerated++;
      }
    }
    if (outdated) setAppSetting(this.db, 'mock_data_version', MOCK_DATA_VERSION);
    return regenerated;
  }
}
