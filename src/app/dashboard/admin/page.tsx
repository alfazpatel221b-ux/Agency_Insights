'use client';

import { useState } from "react";
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { 
  DotsThree, 
  PlusCircle, 
  ShieldCheck, 
  Trash, 
  Warning, 
  CircleNotch, 
  Envelope, 
  UserCheck, 
  PaperPlaneTilt, 
  Database,
  FileCsv,
  CheckCircle,
  ShareNetwork,
  ClockCounterClockwise,
  Eye,
  MicrosoftExcelLogo
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserProfile } from "@/lib/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useCollection, useFirestore, useUser, useDoc, useAuth, useFirebaseApp } from "@/firebase";
import { saveUserRoleAndPermissions, createUser, deleteUser, purgeOtherUsers, resendInvitationEmail, purgeCollection, clearAllKpiData, clearAllSpendsData } from "@/lib/firestore-actions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EditUserRoleDialog } from "./edit-user-role-dialog";
import { AddUserDialog } from "./add-user-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn, openDialogFromMenu } from "@/lib/utils";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationsPanel } from "./notifications-panel";

export default function AdminPage() {
  const firestore = useFirestore();
  const auth = useAuth();
  const app = useFirebaseApp();
  const { toast } = useToast();
  const { user: authUser, loading: authLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<UserProfile>(authUser ? `users/${authUser.uid}` : null);

  const { data: users, loading: usersLoading } = useCollection<UserProfile>('users');

  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [isEditUserDialogOpen, setIsEditUserDialogOpen] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<UserProfile | undefined>(undefined);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [isPurgeAlertOpen, setIsPurgeAlertOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [isResending, setIsResending] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isMaintenanceAlertOpen, setIsMaintenanceAlertOpen] = useState(false);
  const [maintenanceAction, setMaintenanceAction] = useState<{ id: string, label: string } | null>(null);
  const [isMaintenanceProcessing, setIsMaintenanceProcessing] = useState(false);
  const [isSheetsBackfilling, setIsSheetsBackfilling] = useState(false);
  
  const isAdmin = !profileLoading && userProfile?.role === 'Admin';
  const TARGET_EMAIL = 'alfaz.patel@example.com';

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      const deletedCount = await purgeOtherUsers(firestore, TARGET_EMAIL);
      toast({
        title: "Purge Complete",
        description: `Removed ${deletedCount} user profiles. Only ${TARGET_EMAIL} remains.`,
      });
      setIsPurgeAlertOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Purge Failed",
        description: error.message,
      });
    } finally {
      setIsPurging(false);
    }
  };

  const handleSheetsBackfill = async () => {
    setIsSheetsBackfilling(true);
    try {
      const functions = getFunctions(app, "us-central1");
      const backfill = httpsCallable(functions, "backfillActionItemsSheet");
      const result = await backfill();
      const data = result.data as { written?: number; sheetName?: string };
      toast({
        title: "Sheets backfill complete",
        description: `Wrote ${data.written ?? 0} action items to tab ${data.sheetName || "ActionItems"}.`,
      });
    } catch (error: any) {
      const detail =
        error?.details ||
        error?.customData?.message ||
        error?.message ||
        "Deploy 1st gen functions (see functions/README.md).";
      toast({
        variant: "destructive",
        title: "Sheets backfill failed",
        description: typeof detail === "string" ? detail : String(detail),
      });
    } finally {
      setIsSheetsBackfilling(false);
    }
  };

  const handleMaintenanceAction = async () => {
    if (!maintenanceAction) return;
    setIsMaintenanceProcessing(true);
    try {
      let count = 0;
      switch (maintenanceAction.id) {
        case 'deprecated_actions':
          count = await purgeCollection(firestore, 'actionItems');
          break;
        case 'deprecated_wbr':
          count = await purgeCollection(firestore, 'wbrEntries');
          break;
        case 'kpi_reset':
          await clearAllKpiData(firestore);
          count = -1;
          break;
        case 'spends_reset':
          await clearAllSpendsData(firestore);
          count = -1;
          break;
      }
      toast({
        title: "Maintenance Success",
        description: count === -1 ? `Dataset has been fully reset.` : `Cleaned ${count} stale documents.`,
      });
      setIsMaintenanceAlertOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Maintenance Failed",
        description: error.message,
      });
    } finally {
      setIsMaintenanceProcessing(false);
      setMaintenanceAction(null);
    }
  };

  const handleResendInvite = async (user: UserProfile) => {
    setIsResending(user.uid);
    try {
      await resendInvitationEmail(auth, user.email, async (email) => {
        const functions = getFunctions(app, "us-central1");
        const send = httpsCallable(functions, "requestPasswordResetEmail");
        await send({ email, kind: "invite" });
      });
      toast({
        title: "Invite Resent",
        description: `A branded login email from Agency Insights Alerts@example.com has been queued for ${user.email}.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Resend Failed",
        description: error.message || "Could not resend invitation.",
      });
    } finally {
      setIsResending(null);
    }
  };

  const handleCreateUser = async (data: any) => {
    try {
      await createUser(firestore, data);
      toast({
        title: "Invite Sent",
        description: `User created. An invitation from Agency Insights Alerts@example.com should arrive at ${data.email} shortly.`,
      });
      setIsAddUserDialogOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Invitation Failed",
        description: error.message,
      });
    }
  };

  const handleExportUsers = async () => {
    if (!users) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('System Users');

    worksheet.columns = [
      { header: 'Full Name', key: 'displayName', width: 25 },
      { header: 'Email Address', key: 'email', width: 30 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Permissions', key: 'permissions', width: 40 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

    users.forEach(user => {
      worksheet.addRow({
        displayName: user.displayName || 'N/A',
        email: user.email,
        role: user.role,
        status: user.status || 'Invite sent',
        permissions: user.permissions?.join(', ') || 'None',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Agency_User_Database_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    toast({
      title: "Database Exported",
      description: "User records have been saved to your device.",
    });
  };

  const handleCopyInvite = (email: string, id: string) => {
    const appUrl = window.location.origin;
    const inviteMessage = `Welcome to Agency Insights!\n\nAn activation link has been sent to your email (${email}). Please use that unique link to set your password and log in for the first time.\n\nApp URL: ${appUrl}\n\nFor your security, the activation link is sent only to your official inbox. If you haven't received it, please check your spam folder.\n\nBest,\nAgency Insights Admin`;
    
    navigator.clipboard.writeText(inviteMessage);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      title: "Login Instructions Copied",
      description: "Onboarding details and App URL are now on your clipboard.",
    });
  };

  if (authLoading || profileLoading) return <div className="flex flex-1 items-center justify-center p-20"><CircleNotch className="h-8 w-8 animate-spin text-brand" /></div>;
  if (!isAdmin) return <div className="flex flex-1 items-center justify-center p-20 text-center flex-col gap-2"><ShieldCheck size={40} className="text-secondary/20" /><h3 className="font-bold text-lg">Access Denied</h3><p className="text-muted-foreground text-sm">Administrator privileges required.</p></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between border-b border-ink pb-8">
        <div>
          <div className="terminal-overline">Command Center</div>
          <h1 className="text-5xl lg:text-6xl font-black tracking-tighter">Administration</h1>
          <p className="text-[10px] font-mono text-secondary uppercase tracking-[0.2em]">System management, access control, and outbound alerts.</p>
        </div>
      </div>

      <Tabs defaultValue="registry" className="space-y-8">
        <TabsList className="h-12 bg-cream border-ink">
          <TabsTrigger value="registry" className="px-6 text-[10px] font-black uppercase tracking-widest">
            Registry
          </TabsTrigger>
          <TabsTrigger value="notifications" className="px-6 text-[10px] font-black uppercase tracking-widest">
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="mt-0 space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-ink border border-ink overflow-hidden">
        <div className="lg:col-span-2 bg-white flex flex-col border-r border-ink">
          <div className="p-8 flex items-center justify-between border-b border-ink">
            <div>
              <h2 className="text-xl font-bold uppercase tracking-tighter">Registry</h2>
              <p className="text-[10px] font-mono text-secondary uppercase tracking-widest">Active system credentials</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="h-10 border-ink hover:bg-cream transition-colors font-bold uppercase text-[10px] tracking-widest px-4" onClick={handleExportUsers}>
                <FileCsv className="h-4 w-4 mr-2 text-brand" />
                EXPORT
              </Button>
              <Button className="h-10 bg-brand text-white hover:bg-ink font-bold uppercase text-[10px] tracking-widest px-6" onClick={() => setIsAddUserDialogOpen(true)}>
                <PlusCircle className="h-4 w-4 mr-2" />
                INVITE
              </Button>
            </div>
          </div>
          
          <Table>
            <TableHeader>
              <TableRow className="border-none bg-foreground/[0.02] hover:bg-transparent">
                <TableHead className="pl-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Identity</TableHead>
                <TableHead className="py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Role & Modules</TableHead>
                <TableHead className="py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 text-center">Activation</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-20">
                    <div className="flex flex-col items-center gap-2">
                      <CircleNotch className="h-6 w-6 animate-spin text-brand" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-secondary">Syncing Registry...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : users?.map(user => {
                const isRegistered = user.status === 'User Registered';
                const isPending = user.status === 'Pending';
                const isCurrentResending = isResending === user.uid;
                return (
                  <TableRow key={user.id} className="border-b border-ink/5 hover:bg-cream transition-colors">
                    <TableCell className="font-semibold flex items-center gap-3 py-5 pl-8">
                      <Avatar className="h-8 w-8 rounded-none border border-ink">
                        <AvatarFallback className="bg-brand text-white text-[10px] font-black font-mono">
                          {(user.displayName || user.email).charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-xs font-black uppercase tracking-tight leading-none">{user.displayName || 'PENDING'}</div>
                        <div className="text-[9px] font-mono text-secondary uppercase mt-1">{user.email}</div>
                        <Badge variant="outline" className={cn("text-[8px] font-black uppercase rounded-none px-1.5 h-4 mt-2 border-ink", 
                          isRegistered ? "bg-success/10 text-success" : 
                          isPending ? "bg-destructive/10 text-destructive animate-pulse" :
                          "bg-warning/10 text-warning")}>
                          {isPending ? 'APPROVAL REQUIRED' : (user.status || 'Invite sent')}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                          {user.role}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {user.role === 'Admin' ? (
                            <Badge variant="outline" className="text-[8px] font-bold uppercase border-foreground/20">FULL ACCESS</Badge>
                          ) : user.permissions?.map(p => (
                            <Badge key={p} variant="outline" className="text-[8px] font-bold uppercase border-foreground/10 bg-foreground/[0.03]">{p}</Badge>
                          ))}
                          {(!user.permissions || user.permissions.length === 0) && user.role !== 'Admin' && (
                            <span className="text-[9px] font-bold text-destructive/60 uppercase">NO MODULE ACCESS</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                       {user.status === 'Invite sent' ? (
                         <TooltipProvider>
                           <Tooltip>
                             <TooltipTrigger asChild>
                               <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 rounded-none text-brand hover:bg-brand hover:text-white transition-all border border-transparent hover:border-ink" 
                                  onClick={() => handleCopyInvite(user.email, user.uid)}
                                >
                                  {copiedId === user.uid ? <CheckCircle className="h-4 w-4 text-success" /> : <ShareNetwork className="h-4 w-4" />}
                                </Button>
                             </TooltipTrigger>
                             <TooltipContent className="rounded-none bg-ink text-white border-none p-2 text-[10px] font-black uppercase tracking-widest">
                               COPY LOGIN INFO
                             </TooltipContent>
                           </Tooltip>
                         </TooltipProvider>
                       ) : isPending ? (
                         <div className="text-[9px] font-mono font-bold text-destructive uppercase tracking-widest">LOCKED</div>
                       ) : (
                         <div className="text-[9px] font-mono font-bold text-success/40 uppercase tracking-widest">VERIFIED</div>
                       )}
                    </TableCell>
                    <TableCell className="text-right pr-8">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-cream" disabled={user.uid === authUser?.uid || isCurrentResending}>
                            {isCurrentResending ? <CircleNotch className="h-4 w-4 animate-spin" /> : <DotsThree className="h-5 w-5" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-none border-ink bg-white p-1 min-w-[160px]">
                          <DropdownMenuLabel className="text-[9px] font-black uppercase tracking-widest text-secondary px-3 py-2">Actions</DropdownMenuLabel>
                          {user.status === 'Invite sent' && (
                              <DropdownMenuItem className="rounded-none text-xs font-black uppercase flex items-center gap-2 px-3 py-2 cursor-pointer focus:bg-cream" onClick={() => handleResendInvite(user)}>
                                  <PaperPlaneTilt className="h-4 w-4" /> RESEND INVITE
                              </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="rounded-none text-xs font-black uppercase flex items-center gap-2 px-3 py-2 cursor-pointer focus:bg-cream" onSelect={openDialogFromMenu(() => { setSelectedUserForEdit(user); setIsEditUserDialogOpen(true); })}>
                            <Eye className="h-4 w-4" /> MANAGE ACCESS
                          </DropdownMenuItem>
                          <DropdownMenuItem className="rounded-none text-xs font-black uppercase text-destructive flex items-center gap-2 px-3 py-2 cursor-pointer focus:bg-destructive/10" onSelect={openDialogFromMenu(() => setUserToDelete(user))}>
                            <Trash className="h-4 w-4" /> DELETE USER
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="bg-cream p-8 space-y-8 h-full">
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 text-brand mb-2">
                <MicrosoftExcelLogo weight="fill" className="h-5 w-5" />
                <h3 className="text-lg font-black uppercase tracking-tighter">Google Sheets Sync</h3>
              </div>
              <p className="text-[10px] font-mono text-secondary uppercase tracking-widest leading-relaxed">
                Live sync runs via Cloud Function on every action-item write. Use backfill once after deploy (or anytime you need a full rebuild).
              </p>
            </div>
            <MaintenanceButton
              label={isSheetsBackfilling ? "Backfilling…" : "Backfill Action Items to Sheet"}
              icon={isSheetsBackfilling ? <CircleNotch className="animate-spin" /> : <MicrosoftExcelLogo />}
              onClick={handleSheetsBackfill}
              disabled={isSheetsBackfilling}
            />
          </div>

          <div className="space-y-6 pt-8 border-t border-ink/10">
            <div>
              <div className="flex items-center gap-2 text-brand mb-2">
                <Database weight="fill" className="h-5 w-5" />
                <h3 className="text-lg font-black uppercase tracking-tighter">Maintenance</h3>
              </div>
              <p className="text-[10px] font-mono text-secondary uppercase tracking-widest leading-relaxed">
                Admin-only data resets. Full KPI / Spends wipes live here — not on tracker pages.
              </p>
            </div>
            
            <div className="space-y-3">
              <MaintenanceButton 
                label="Clear Action Archive" 
                icon={<Trash />}
                onClick={() => { setMaintenanceAction({ id: 'deprecated_actions', label: 'Purge Action Items' }); setIsMaintenanceAlertOpen(true); }}
              />
              <MaintenanceButton 
                label="Clear WBR Records" 
                icon={<Trash />}
                onClick={() => { setMaintenanceAction({ id: 'deprecated_wbr', label: 'Purge WBR Entries' }); setIsMaintenanceAlertOpen(true); }}
              />
              <div className="h-px bg-ink/10 my-4" />
              <MaintenanceButton 
                label="Clear All KPI Data" 
                icon={<Warning />}
                onClick={() => { setMaintenanceAction({ id: 'kpi_reset', label: 'Clear All KPI Data (kpis + weekly)' }); setIsMaintenanceAlertOpen(true); }}
              />
              <MaintenanceButton 
                label="Clear All Spends Data" 
                icon={<Warning />}
                onClick={() => { setMaintenanceAction({ id: 'spends_reset', label: 'Clear All Spends Data (monthly + weekly)' }); setIsMaintenanceAlertOpen(true); }}
              />
            </div>
          </div>

          <div className="space-y-6 pt-8 border-t border-ink/10">
            <div>
              <div className="flex items-center gap-2 text-destructive mb-2">
                <Warning weight="fill" className="h-5 w-5" />
                <h3 className="text-lg font-black uppercase tracking-tighter">Danger Zone</h3>
              </div>
            </div>
            
            <div className="bg-destructive/5 border border-destructive/20 p-6 space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-destructive leading-relaxed">
                Remove all users except master administrator <strong>{TARGET_EMAIL}</strong>.
              </p>
              <Button 
                variant="destructive" 
                className="w-full h-12 rounded-none font-black uppercase tracking-widest text-[10px] brutalist-shadow transition-all active:translate-x-1 active:translate-y-1 active:shadow-none"
                onClick={() => setIsPurgeAlertOpen(true)}
              >
                EXECUTE PURGE
              </Button>
            </div>
          </div>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-0">
          <NotificationsPanel />
        </TabsContent>
      </Tabs>
      
      <AddUserDialog 
        isOpen={isAddUserDialogOpen} 
        onOpenChange={setIsAddUserDialogOpen} 
        onSave={handleCreateUser} 
      />
      
      <EditUserRoleDialog 
        isOpen={isEditUserDialogOpen} 
        onOpenChange={(open) => {
          setIsEditUserDialogOpen(open);
          if (!open) setSelectedUserForEdit(null);
        }} 
        onSave={(d, id) => { saveUserRoleAndPermissions(firestore, id, d.role, d.permissions, selectedUserForEdit?.status === 'Pending' ? 'User Registered' : undefined); setIsEditUserDialogOpen(false); }} 
        user={selectedUserForEdit} 
      />

      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent className="rounded-none border-ink bg-white p-10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-3xl font-black uppercase tracking-tighter">Delete User Account?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-secondary/80 mt-4 leading-relaxed">
              This action is irreversible. All access for this user will be immediately removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-10 gap-4">
            <AlertDialogCancel className="rounded-none border-ink h-12 px-8 font-black uppercase tracking-widest text-[10px]">CANCEL</AlertDialogCancel>
            <AlertDialogAction className="rounded-none bg-destructive hover:bg-ink h-12 px-10 font-black uppercase tracking-widest text-[10px]" onClick={async () => { 
              if (userToDelete) await deleteUser(firestore, userToDelete.id); 
              setUserToDelete(null); 
            }}>
              CONFIRM DELETE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isPurgeAlertOpen} onOpenChange={setIsPurgeAlertOpen}>
        <AlertDialogContent className="rounded-none border-ink bg-white p-10">
          <AlertDialogHeader>
            <div className="flex items-center gap-4 text-destructive mb-4">
              <Warning weight="fill" size={48} />
              <AlertDialogTitle className="text-4xl font-black uppercase tracking-tighter">Emergency Purge</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm font-black text-ink uppercase tracking-widest leading-relaxed">
              Executing mass registry deletion. Only <strong>{TARGET_EMAIL}</strong> will keep access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-10 gap-4">
            <AlertDialogCancel className="rounded-none border-ink h-12 px-8 font-black uppercase tracking-widest text-[10px]" disabled={isPurging}>CANCEL</AlertDialogCancel>
            <AlertDialogAction 
              className="rounded-none bg-destructive hover:bg-ink h-12 px-12 font-black uppercase tracking-widest text-[10px]" 
              onClick={handlePurge}
              disabled={isPurging}
            >
              {isPurging ? "PURGING..." : "EXECUTE"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isMaintenanceAlertOpen} onOpenChange={setIsMaintenanceAlertOpen}>
        <AlertDialogContent className="rounded-none border-ink bg-white p-10">
          <AlertDialogHeader>
            <div className="flex items-center gap-4 text-brand mb-4">
              <Database weight="fill" size={48} />
              <AlertDialogTitle className="text-3xl font-black uppercase tracking-tighter">System Maintenance</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm font-black uppercase tracking-widest text-ink leading-relaxed">
              Confirming: <strong>{maintenanceAction?.label}</strong>. Data will be permanently wiped from the archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-10 gap-4">
            <AlertDialogCancel className="rounded-none border-ink h-12 px-8 font-black uppercase tracking-widest text-[10px]" disabled={isMaintenanceProcessing}>CANCEL</AlertDialogCancel>
            <AlertDialogAction 
              className="rounded-none bg-brand hover:bg-ink h-12 px-12 font-black uppercase tracking-widest text-[10px]" 
              onClick={handleMaintenanceAction}
              disabled={isMaintenanceProcessing}
            >
              {isMaintenanceProcessing ? "PROCESSING..." : "CONFIRM PURGE"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MaintenanceButton({ label, icon, onClick, disabled }: { label: string, icon: React.ReactNode, onClick: () => void, disabled?: boolean }) {
  return (
    <Button 
      variant="outline" 
      className="w-full h-12 rounded-none font-black uppercase tracking-widest text-[10px] flex items-center justify-between border-ink hover:bg-ink hover:text-white transition-all group px-4"
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      <span className="text-secondary group-hover:opacity-100 transition-opacity">{icon}</span>
    </Button>
  );
}
