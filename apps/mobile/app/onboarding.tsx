import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuthStore } from '../src/auth-store';
import { ActionButton, colors } from '../src/design';
import { AuthPage, styles } from './auth/login';

export default function OnboardingPage() {
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);

  const continueToApp = async () => {
    await completeOnboarding();
    router.replace('/' as never);
  };

  return <AuthPage title="先把边界说清楚" subtitle="懒人装甲会帮你管理事务，但不会替你越过授权边界。">
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>你始终掌握控制权</Text>
      <Text style={styles.infoCopy}>计划会显示数据来源、触发条件、执行动作和风险等级。需要确认的事项会先向你请求审批。</Text>
    </View>
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>敏感操作默认保守</Text>
      <Text style={styles.infoCopy}>涉及资金、账户权限和外部写入的操作，未完成安全验证前不会自动执行。</Text>
    </View>
    <View style={styles.infoBlock}>
      <Text style={styles.infoTitle}>从一个小计划开始</Text>
      <Text style={styles.infoCopy}>你可以先从模板库挑选一件想少操心的小事，随时暂停、修改或删除计划。</Text>
    </View>
    <View style={styles.action}><ActionButton label="我明白了，开始使用" onPress={() => void continueToApp()} /></View>
  </AuthPage>;
}
