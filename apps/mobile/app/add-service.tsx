import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Card, EditorPage, ui } from '../src/editor-ui';
export default function AddService() { return <EditorPage title="添加服务"><Text style={ui.title}>你想添加什么服务？</Text><Card><Pressable style={ui.row} onPress={() => router.push('/add-external-service' as never)}><Text style={ui.title}>添加外部服务 ›</Text></Pressable><Text style={ui.detail}>添加从第三方 App、网页分享的具体服务链接。</Text></Card><Card><Pressable style={ui.row} onPress={() => router.push('/publish-service' as never)}><Text style={ui.title}>发布内部服务 ›</Text></Pressable><Text style={ui.detail}>在懒人装甲平台发布你提供的服务。</Text></Card></EditorPage>; }
