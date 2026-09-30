import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "../../src/api";
import { useAuthStore } from "../../src/auth-store";
import { useChatHistory } from "../../src/chat-history-store";
import {
  EmptyState,
  workspaceColors as colors,
  radius,
  spacing,
  typography,
} from "../../src/design";
import {
  presentRunningPlan,
  selectRunningPlanCards,
  type HomeRecentPlan,
} from "../../src/home-presenter";

interface TodayData {
  recentPlans: HomeRecentPlan[];
}

export default function HomePage() {
  const token = useAuthStore((store) => store.token);
  const profile = useQuery({
    queryKey: ["me", token],
    queryFn: () => api<{ displayName: string }>("/me", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const name = profile.data?.displayName || "朋友";
  const historyItems = useChatHistory((state) => state.items);
  const recentChats = historyItems
    .filter((item) => item.owner === token)
    .slice(0, 2);
  const today = useQuery({
    queryKey: ["today", token],
    queryFn: () => api<TodayData>("/today", token),
    enabled: Boolean(token),
    refetchInterval: 15_000,
  });
  const cards = useMemo(
    () => selectRunningPlanCards(today.data?.recentPlans ?? []),
    [today.data?.recentPlans],
  );
  const sessionExpired =
    today.error instanceof ApiError && today.error.status === 401;
  return (
    <SafeAreaView edges={[]} style={styles.safeArea}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={
          token ? (
            <RefreshControl
              tintColor={colors.primary}
              refreshing={today.isFetching}
              onRefresh={() => today.refetch()}
            />
          ) : undefined
        }
      >
        <Text style={styles.greeting}>
          {new Date().getHours() < 12
            ? "上午好"
            : new Date().getHours() < 18
              ? "下午好"
              : "晚上好"}
          ，{name}
        </Text>
        <Text style={styles.greetingNote}>今天也要有条不紊地前进 ✨</Text>
        <View style={styles.shortcuts}>
          {(
            [
              {
                label: "新建计划",
                icon: "add",
                color: "#17191D",
                route: "/create",
              },
              {
                label: "查看今天",
                icon: "calendar-outline",
                color: "#FF676B",
                route: "/todo",
              },
              {
                label: "专注一下",
                icon: "checkmark-circle-outline",
                color: "#1684FF",
                route: "/plans",
              },
              {
                label: "灵感收集",
                icon: "bulb-outline",
                color: "#FFA000",
                route: "/search-ai",
              },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => [
                styles.shortcut,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name={item.icon} size={30} color={item.color} />
              <Text style={styles.shortcutLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.todaySurface}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>
              今天 ·{" "}
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push("/plan-center?filter=running" as never)
              }
              style={({ pressed }) => [
                styles.textAction,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.textActionLabel}>查看全部</Text>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={colors.primary}
              />
            </Pressable>
          </View>
          <Text style={styles.timelineCaption}>
            持续跟进的计划 · 时间为最近活动
          </Text>
          {!token ? (
            <EmptyState
              icon="shield-checkmark-outline"
              title="登录后查看计划"
              description="查看今天要关注的事，安排接下来的计划。"
              action={{
                label: "去登录",
                onPress: () => router.push("/auth/login" as never),
              }}
            />
          ) : null}
          {token && today.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>正在加载计划…</Text>
            </View>
          ) : null}
          {token && today.isError ? (
            <InlineState
              title={sessionExpired ? "登录已过期" : "暂时无法读取计划"}
              detail={
                sessionExpired
                  ? "重新登录后即可查看你的计划。"
                  : "请检查网络连接后重试。"
              }
              action={sessionExpired ? "去登录" : "重试"}
              onPress={() =>
                sessionExpired
                  ? router.push("/auth/login" as never)
                  : today.refetch()
              }
            />
          ) : null}
          {token && !today.isLoading && !today.isError && cards.length === 0 ? (
            <View style={styles.emptyRunning}>
              <View style={styles.emptyRunningIcon}>
                <Ionicons
                  name="layers-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={styles.emptyRunningCopy}>
                <Text style={styles.emptyRunningTitle}>没有正在管理的计划</Text>
                <Text style={styles.muted}>
                  新建一个计划，开始安排今天的事。
                </Text>
              </View>
            </View>
          ) : null}
          {cards.length > 0 && !today.isError ? (
            <RunningPlanTimeline plans={cards} />
          ) : null}
        </View>
        <View style={[styles.sectionHeading, styles.createHeading]}>
          <Text style={styles.sectionTitle}>为你推荐</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/templates" as never)}
          >
            <Text style={styles.textActionLabel}>查看全部 ›</Text>
          </Pressable>
        </View>
        <View style={styles.recommendations}>
          {(
            [
              {
                title: "整理会议纪要",
                detail: "梳理重点与行动项",
                icon: "document-text-outline",
                color: "#49BA83",
                route: "/templates/daily-important-summary",
              },
              {
                title: "制定下周计划",
                detail: "安排接下来的事",
                icon: "git-network-outline",
                color: "#8A64FF",
                route: "/create",
              },
              {
                title: "回复重要邮件",
                detail: "整理邮件与回复思路",
                icon: "mail-outline",
                color: "#F4A000",
                route: "/search-ai",
              },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              onPress={() => router.push(item.route as never)}
              style={styles.recommendation}
            >
              <View
                style={[
                  styles.recommendationIcon,
                  { backgroundColor: item.color + "18" },
                ]}
              >
                <Ionicons name={item.icon} size={25} color={item.color} />
              </View>
              <Text style={styles.recommendationTitle}>{item.title}</Text>
              <Text style={styles.muted}>{item.detail}</Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.sectionHeading, styles.createHeading]}>
          <Text style={styles.sectionTitle}>最近对话</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/search-ai" as never)}
            style={styles.textAction}
          >
            <Text style={styles.textActionLabel}>查看全部 ›</Text>
          </Pressable>
        </View>
        <View style={styles.recentSurface}>
          {recentChats.length ? (
            recentChats.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/search-ai",
                    params: { conversationId: item.id },
                  } as never)
                }
                style={[styles.recentRow, index > 0 && styles.recentDivider]}
              >
                <Ionicons name="chatbubble-outline" size={26} color="#17191D" />
                <View style={styles.recentCopy}>
                  <Text numberOfLines={1} style={styles.recentTitle}>
                    {item.question}
                  </Text>
                  <Text numberOfLines={1} style={styles.muted}>
                    继续查看这次对话
                  </Text>
                </View>
                <Text style={styles.recentTime}>
                  {new Date(item.createdAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
            ))
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/search-ai" as never)}
              style={styles.recentRow}
            >
              <Ionicons name="chatbubble-outline" size={26} color="#17191D" />
              <View style={styles.recentCopy}>
                <Text style={styles.recentTitle}>还没有最近对话</Text>
                <Text style={styles.muted}>到聊天页开始一个新话题</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#949AA5" />
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RunningPlanTimeline({ plans }: { plans: readonly HomeRecentPlan[] }) {
  return (
    <View style={styles.timeline}>
      {plans.map((plan, index) => {
        const presentation = presentRunningPlan(plan);
        const activity = plan.lastActivityAt
          ? new Date(plan.lastActivityAt)
          : null;
        const validActivity = activity && !Number.isNaN(activity.getTime());
        return (
          <Pressable
            key={plan.planId}
            accessibilityRole="button"
            accessibilityLabel={`${plan.planName ?? "未命名计划"}，${presentation.label}。${presentation.summary}`}
            onPress={() => router.push(`/plans/${plan.planId}` as never)}
            style={({ pressed }) => [
              styles.timelineRow,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.timelineTrack}>
              {index < plans.length - 1 ? (
                <View style={styles.timelineLine} />
              ) : null}
              <View
                style={[
                  styles.timelineDot,
                  plan.executionStatus === "running" &&
                    styles.timelineDotActive,
                ]}
              />
            </View>
            <View style={styles.timelineTime}>
              <Text style={styles.timelineClock}>
                {validActivity
                  ? activity.toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </Text>
              <Text style={styles.timelineDate}>
                {validActivity
                  ? activity.toLocaleDateString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                    })
                  : "暂无活动"}
              </Text>
            </View>
            <View style={styles.timelineCopy}>
              <Text numberOfLines={1} style={styles.timelineTitle}>
                {plan.planName ?? "未命名计划"}
              </Text>
              <Text numberOfLines={2} style={styles.timelineSummary}>
                {presentation.summary}
              </Text>
            </View>
            <View
              style={[
                styles.timelineStatus,
                presentation.tone === "warning" && {
                  backgroundColor: "#FFF0D9",
                },
              ]}
            >
              <Text
                style={[
                  styles.timelineStatusText,
                  presentation.tone === "warning" && { color: "#AC7C38" },
                ]}
              >
                {presentation.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function InlineState({
  title,
  detail,
  action,
  onPress,
}: {
  title: string;
  detail: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.inlineState}>
      <View style={styles.inlineCopy}>
        <Text style={styles.emptyRunningTitle}>{title}</Text>
        <Text style={styles.muted}>{detail}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={styles.inlineAction}
      >
        <Text style={styles.inlineActionText}>{action}</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  recentSurface: {
    backgroundColor: "rgba(255,255,255,0.86)",
    borderRadius: 26,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  recentRow: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  recentCopy: { flex: 1, gap: 5, minWidth: 0 },
  recentTitle: { fontSize: 15, fontWeight: "600", color: "#17191D" },
  recentTime: {
    fontSize: 12,
    color: "#949AA5",
    alignSelf: "flex-start",
    marginTop: 20,
  },
  recentDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9EAED",
  },
  timelineCaption: { fontSize: 11, color: "#A0A4AD", marginBottom: 14 },
  timeline: { paddingTop: 6 },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 82,
    gap: 8,
  },
  timelineTrack: {
    width: 12,
    alignSelf: "stretch",
    alignItems: "center",
    paddingTop: 6,
  },
  timelineLine: {
    position: "absolute",
    top: 10,
    bottom: -10,
    width: 1,
    backgroundColor: "#E8E9ED",
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#D9DBE0",
    backgroundColor: "#FFFFFF",
  },
  timelineDotActive: { backgroundColor: "#1684FF", borderColor: "#1684FF" },
  timelineTime: { width: 44, gap: 4 },
  timelineClock: { fontSize: 12, color: "#949AA5" },
  timelineDate: { fontSize: 10, color: "#B0B4BC" },
  timelineCopy: { flex: 1, gap: 6 },
  timelineTitle: { fontSize: 15, color: "#17191D", fontWeight: "600" },
  timelineSummary: { fontSize: 12, lineHeight: 19, color: "#949AA5" },
  timelineStatus: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#E4F0FF",
    maxWidth: 88,
  },
  timelineStatusText: { fontSize: 10, color: "#1684FF", fontWeight: "600" },
  greeting: { fontSize: 30, fontWeight: "700", color: "#13161B", marginTop: 8 },
  greetingNote: {
    fontSize: 16,
    color: "#8C96A2",
    marginTop: 10,
    marginBottom: 24,
  },
  shortcuts: { flexDirection: "row", gap: 9, marginBottom: 22 },
  shortcut: {
    flex: 1,
    minHeight: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 22,
    backgroundColor: "#FFFFFFDB",
  },
  shortcutLabel: { fontSize: 12, fontWeight: "600", color: "#17191D" },
  todaySurface: { padding: 16, borderRadius: 26, backgroundColor: "#FFFFFFDF" },
  recommendations: { flexDirection: "row", gap: 10, marginTop: 8 },
  recommendation: {
    flex: 1,
    padding: 12,
    borderRadius: 23,
    backgroundColor: "#FFFFFFDE",
    gap: 8,
  },
  recommendationIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendationTitle: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    color: "#17191D",
  },

  safeArea: { flex: 1, backgroundColor: "transparent", overflow: "hidden" },
  page: { flex: 1, backgroundColor: "transparent" },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 72,
    paddingBottom: spacing.xxl,
  },
  sectionHeading: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
    fontSize: 18,
    lineHeight: 25,
  },
  textAction: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.md,
  },
  textActionLabel: {
    ...typography.caption,
    color: "#B18D59",
    fontWeight: "700",
  },
  pressed: { opacity: 0.72 },
  loading: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  muted: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  emptyRunning: {
    minHeight: 104,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyRunningIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  emptyRunningCopy: { flex: 1 },
  emptyRunningTitle: { ...typography.bodyStrong, color: colors.text },
  createHeading: { marginTop: spacing.xl },
  inlineState: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inlineCopy: { flex: 1 },
  inlineAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  inlineActionText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontWeight: "800",
  },
});
