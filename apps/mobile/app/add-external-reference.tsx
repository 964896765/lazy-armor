import { router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
export default function AddExternalReference(){return <EditorPage title="添加外部服务"><Card title="从其它 App 分享"><Text style={ui.detail}>在其它 App 或网页打开具体服务，点击分享并选择懒人装甲。分享内容将在确认后保存为你的外部服务引用。</Text></Card><Card title="粘贴链接"><Text style={ui.detail}>复制具体服务的链接，在下一页粘贴并补充名称。</Text><Button label="粘贴服务链接" onPress={()=>router.push('/add-external-service' as never)}/></Card><Button secondary label="手动添加" onPress={()=>router.push('/add-external-service' as never)}/></EditorPage>;}
