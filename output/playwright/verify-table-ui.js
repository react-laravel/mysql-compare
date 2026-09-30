async (page) => {
  const filter = page.getByRole('searchbox', { name: '使用 WHERE 条件筛选数据' });
  await filter.fill('id > 10');
  await page.getByText('尚未应用', { exact: true }).waitFor();
  await filter.press('Enter');
  await page.getByText('已筛选', { exact: true }).waitFor();
  if (await page.getByText('尚未应用', { exact: true }).count()) throw new Error('Applied filter still pending');
  await filter.press('Escape');
  const input = page.getByRole('spinbutton', { name: '页码' });
  await input.waitFor();
  await input.fill('3');
  await input.press('Escape');
  if (await input.inputValue() !== '1') throw new Error('Escape committed the page draft');
  await page.getByRole('checkbox', { name: '选择第 1 行', exact: true }).check();
  await page.getByRole('button', { name: /删除.*1/ }).waitFor();
  await page.screenshot({path:'output/playwright/mysql-ui-selection-narrow.png',scale:'css'});
  await page.getByRole('button', {name:'清除', exact:true}).click();
  if (await page.getByRole('button', {name:/删除.*1/}).count()) throw new Error('Selection did not clear');
  console.log('Filter apply/clear, page Escape, and contextual selection verified');
}
