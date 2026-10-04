import { Redirect, useLocalSearchParams } from 'expo-router';
export default function LegacyConnection(){const {id}=useLocalSearchParams<{id:string}>();return <Redirect href={{pathname:'/resource-detail',params:{id}} as never}/>;}
