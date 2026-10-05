import { Solar } from 'lunar-javascript';

/** Date labels only: no task, availability or execution state. */
export function calendarDateInfo(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const solar = Solar.fromYmd(year!, month!, day!);
  const lunar = solar.getLunar();
  const civilFestivals = new Set(['元旦节', '元旦', '劳动节', '国庆节', '儿童节', '建军节', '教师节']);
  const festivals = [...new Set([...lunar.getFestivals(), ...solar.getFestivals().filter(name => civilFestivals.has(name))])];
  const term = lunar.getJieQi();
  return { lunar: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`, lunarDay: lunar.getDayInChinese(),
    year: `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`, term, festivals,
    label: festivals[0] ?? (term || (lunar.getDayInChinese() === '初一' ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese())) };
}
