import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SegmentedControl, drawerTokens } from './consumer-ui';
import { ui } from './editor-ui';
export type ServiceMode = 'internal' | 'external';
export function ServiceWorkbenchDrawer({ open, mode, onModeChange, onClose }: { open:boolean;mode:ServiceMode;onModeChange:(mode:ServiceMode)=>void;onClose:()=>void }) {
  const insets=useSafeAreaInsets();
  const entries = [{ title:'我的服务', detail:'预约、进行中和历史服务',path:'/service-requests?role=consumer' }, { title:'收到的请求',detail:'处理别人向你发起的服务',path:'/service-requests?role=provider' }, {title:'我的发布',detail:'管理已发布、草稿和下架服务',path:'/my-service-offerings'}];
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}><View style={{flex:1,flexDirection:'row',backgroundColor:'rgba(20,35,60,0.3)'}}>
    <View style={{width:drawerTokens.width,maxWidth:drawerTokens.maxWidth,height:'100%',backgroundColor:drawerTokens.background,paddingHorizontal:16,paddingTop:insets.top+8,paddingBottom:Math.max(insets.bottom,24)}}>
      <View style={ui.line}><Text style={[drawerTokens.title,{flex:1,textAlign:'left'}]}>服务工作台</Text><Pressable accessibilityLabel="关闭服务工作台" style={ui.back} onPress={onClose}><Ionicons name="close" size={24}/></Pressable></View>
      <SegmentedControl variant="drawer" value={mode} options={[{value:'internal',label:'内部服务'},{value:'external',label:'外部服务'}]} onChange={onModeChange}/>
      <ScrollView style={{flex:1}} contentContainerStyle={{gap:12,paddingVertical:16}}><Text style={drawerTokens.body}>{mode==='internal'?'查看和管理你的服务':'管理你保存的具体外部服务引用'}</Text>
        {mode==='internal'?entries.map(item=><Pressable key={item.title} accessibilityRole="button" style={[ui.card,ui.line,{padding:16,backgroundColor:drawerTokens.card}]} onPress={()=>{onClose();router.push(item.path as never);}}><View style={{flex:1,gap:6}}><Text style={drawerTokens.item}>{item.title}</Text><Text style={drawerTokens.body}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={20}/></Pressable>):<Pressable accessibilityRole="button" style={[ui.card,{backgroundColor:drawerTokens.card}]} onPress={onClose}><Text style={drawerTokens.item}>我的外部服务引用</Text><Text style={drawerTokens.body}>返回外部服务目录管理具体入口</Text></Pressable>}
      <Pressable accessibilityRole="button" style={[ui.row,{minHeight:48,marginTop:24,borderTopWidth:1,borderTopColor:"rgba(90,115,150,0.15)"}]} onPress={()=>{onClose();router.push('/service-settings' as never);}}><Text style={[drawerTokens.item,{flex:1}]}>服务设置</Text><Ionicons name="chevron-forward" size={20}/></Pressable></ScrollView>
    </View><Pressable accessibilityLabel="关闭服务侧边栏" style={{flex:1}} onPress={onClose}/>
  </View></Modal>;
}
