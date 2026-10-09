import {useQuery} from '@tanstack/react-query';
import {router} from 'expo-router';
import {Image,Pressable,Text} from 'react-native';
import {api} from './api';
import {useAuthStore} from './auth-store';
export function ProfileAvatar(){const token=useAuthStore(s=>s.token),profile=useQuery({queryKey:['me',token],queryFn:()=>api<{displayName:string;avatar?:string|null}>('/me',token),enabled:Boolean(token),staleTime:60000});return <Pressable accessibilityRole="button" accessibilityLabel="我的" onPress={()=>router.push('/profile' as never)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}>{profile.data?.avatar&&/^https?:\/\//.test(profile.data.avatar)?<Image source={{uri:profile.data.avatar}} style={{width:32,height:32,borderRadius:16}}/>:<Text style={{width:32,height:32,borderRadius:16,textAlign:'center',lineHeight:32,backgroundColor:'rgba(255,255,255,0.5)',color:'#172033'}}>{profile.data?.displayName?.charAt(0)||'我'}</Text>}</Pressable>;}
