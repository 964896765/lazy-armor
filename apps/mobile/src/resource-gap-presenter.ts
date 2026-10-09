export function resourceGapStatus(status:string,reasons:string[]) {
  if(status==='COMPLETED')return '原查询已恢复，结果见下方。';
  if(status==='SUPERSEDED')return '原需求已变化，这条查询不会继续读取。';
  if(status==='READ_PENDING')return '权限已核对，正在读取你授权的通知来源。';
  if(status==='WAITING_FACT_CONFIRMATION')return '读到了物流候选，请核实后继续原查询。';
  if(status==='READ_FAILED')return '通知读取未完成，不能据此判断快递状态。';
  if(reasons.includes('NOTIFICATION_ACCESS_REQUIRED'))return '需要开启 Android 通知访问权限。';
  if(reasons.includes('NOTIFICATION_COLLECTION_UNAVAILABLE'))return '通知采集暂不可用，请检查消息获取开关和监听状态。';
  if(reasons.includes('NOTIFICATION_GRANT_REQUIRED'))return '需要允许懒人装甲读取本机通知。';
  if(reasons.includes('WAITING_DEVICE'))return '正在等待手机上线，原查询已保存。';
  if(reasons.includes('APP_SOURCE_REQUIRED')||reasons.includes('APP_SOURCE_GRANT_REQUIRED'))return '需要添加并授权你选择的应用作为通知来源。';
  return '正在等待可用的通知来源，开启后自动继续原查询。';
}
