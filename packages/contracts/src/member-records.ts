/**
 * 成员目录：只保存用户自己起的称呼、角色说明与启用状态。
 *
 * 成员不是账号，也不是认证身份；这里不要求真实姓名、电话或邮箱，界面上的成员字段也不能
 * 用来断言“已由某人审批”。项目分工、评审与交接只引用成员的稳定 id。
 */
import type { RecordBase } from './records'

/** 成员目录里的一条。 */
export interface MemberRecord extends RecordBase {
  kind: 'member'
  /** 显示称呼，由用户自己起；改名不改变 id。 */
  title: string
  /** 角色说明，如“算法负责人”；不是权限。 */
  role?: string
  /** 停用后仍可查询，历史分工不被级联删除。 */
  enabled: boolean
  note?: string
}
