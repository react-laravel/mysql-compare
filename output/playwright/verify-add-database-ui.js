async (page) => {
  if (await page.evaluate(() => window.api.runtime.mode) !== 'web') throw new Error('Expected disposable mock preview');
  const dialog = page.getByRole('dialog');
  const existing = dialog.getByRole('button', {name:'analytics 已添加'});
  if (!(await existing.isDisabled())) throw new Error('Existing database is selectable');
  await dialog.getByRole('button', {name:'analytics_archive',exact:true}).click();
  if (await dialog.getByRole('textbox', {name:'数据库名'}).inputValue() !== 'analytics_archive') throw new Error('Discovered choice did not populate');
  await dialog.getByRole('textbox', {name:'用户名'}).fill('preview_user');
  await dialog.getByRole('textbox', {name:'密码'}).fill('preview-only');
  await dialog.getByRole('textbox', {name:'密码'}).press('Enter');
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('treeitem', {name:/analytics_archive/}).waitFor();
  const closeToast = page.getByRole('button', {name:'关闭提示'});
  while (await closeToast.count()) await closeToast.first().click();
  await page.getByRole('button', {name:'添加数据库',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  if (await page.getByRole('textbox', {name:'数据库名'}).inputValue() !== '') throw new Error('Reopened dialog retains name');
  await page.getByRole('radio', {name:'使用其他账号'}).click();
  if (await page.getByRole('textbox', {name:'密码'}).inputValue() !== '') throw new Error('Reopened dialog retains password');
  await page.getByRole('button', {name:'发现数据库',exact:true}).click();
  await page.getByRole('list', {name:'发现的数据库'}).waitFor();
  await page.screenshot({path:'output/playwright/mysql-ui-add-database.png',scale:'css'});
  await page.getByRole('button', {name:'取消',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
}
