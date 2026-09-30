async (page) => {
  const grid = page.getByRole('table', {name:'表数据'});
  await grid.waitFor();
  const before = await grid.locator('tbody tr').count();
  if (!before) throw new Error('Expected loaded rows');
  await page.evaluate(() => {
    window.__mysqlUiRestoreQuery = window.api.db.queryRows;
    window.api.db.queryRows = async () => ({ok:false,error:'模拟网络中断，请重试'});
  });
  try {
    await page.getByRole('button', {name:'刷新', exact:true}).click();
    await page.getByText('刷新失败，仍显示上次加载的结果。', {exact:true}).waitFor();
    if (await grid.locator('tbody tr').count() !== before) throw new Error('Refresh failure cleared rows');
    await page.screenshot({path:'output/playwright/mysql-ui-refresh-failed.png',scale:'css'});
  } finally {
    await page.evaluate(() => {
      window.api.db.queryRows = window.__mysqlUiRestoreQuery;
      delete window.__mysqlUiRestoreQuery;
    });
  }
  await page.getByRole('button', {name:'重试',exact:true}).click();
  await page.getByText('刷新失败，仍显示上次加载的结果。', {exact:true}).waitFor({state:'hidden'});
  await grid.waitFor();
  if (await grid.locator('tbody tr').count() !== before) throw new Error('Retry did not restore rows');
}
