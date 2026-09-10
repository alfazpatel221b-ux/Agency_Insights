'use client';

import { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useUser, useDoc, useAuth, useFirestore } from '@/firebase';
import { UserProfile } from '@/lib/types';
import { changeUserPassword, updateUserDisplayName } from '@/lib/firestore-actions';
import { releaseRadixPointerLock } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const profileSchema = z.object({
  displayName: z.string().min(1, 'Full name is required').max(80, 'Name is too long'),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(128, 'Password is too long'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

interface ProfileManagementDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function mapAuthError(error: any): string {
  const code = error?.code as string | undefined;
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Current password is incorrect.';
    case 'auth/weak-password':
      return 'New password is too weak. Use at least 8 characters.';
    case 'auth/requires-recent-login':
      return 'Please sign out and sign in again, then retry changing your password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    default:
      return error?.message || 'Something went wrong. Please try again.';
  }
}

export function ProfileManagementDialog({ isOpen, onOpenChange }: ProfileManagementDialogProps) {
  const auth = useAuth();
  const firestore = useFirestore();
  const { user } = useUser();
  const { data: userProfile } = useDoc<UserProfile>(user ? `users/${user.uid}` : null);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '' },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setIsSavingProfile(false);
        setIsChangingPassword(false);
        passwordForm.reset();
        releaseRadixPointerLock();
      }
      onOpenChange(open);
    },
    [onOpenChange, passwordForm]
  );

  useEffect(() => {
    if (isOpen && userProfile) {
      profileForm.reset({
        displayName: userProfile.displayName || '',
      });
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }
  }, [isOpen, userProfile, profileForm, passwordForm]);

  const onSaveProfile = async (data: ProfileFormValues) => {
    if (!user || !firestore) return;
    setIsSavingProfile(true);
    try {
      await updateUserDisplayName(firestore, user, data.displayName);
      toast.success('Profile updated');
    } catch (error: any) {
      toast.error(mapAuthError(error));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const onChangePassword = async (data: PasswordFormValues) => {
    if (!user) return;
    setIsChangingPassword(true);
    try {
      await changeUserPassword(user, data.currentPassword, data.newPassword);
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      toast.success('Password changed successfully');
    } catch (error: any) {
      toast.error(mapAuthError(error));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const email = userProfile?.email || user?.email || '—';
  const role = userProfile?.role || '—';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto rounded-none glass"
        data-testid="profile-management-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">Profile Management</DialogTitle>
          <DialogDescription>
            Update your display name or change your account password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 pt-2">
          <div className="space-y-3 border border-hairline p-4 bg-foreground/[0.02]">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Account</p>
            <div className="space-y-1">
              <p className="text-xs text-secondary uppercase tracking-wider">Email</p>
              <p className="text-sm font-medium text-ink truncate">{email}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-secondary uppercase tracking-wider">Role</p>
              <p className="text-sm font-medium text-ink">{role}</p>
            </div>
          </div>

          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60">
                Display Name
              </p>
              <FormField
                control={profileForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">
                      Full Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        className="rounded-none bg-foreground/5 border-none"
                        placeholder="Your name"
                        disabled={isSavingProfile}
                        data-testid="profile-display-name-input"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="sm:justify-start">
                <Button
                  type="submit"
                  className="rounded-none uppercase tracking-widest text-xs font-bold"
                  disabled={isSavingProfile || !user || !firestore}
                  data-testid="profile-save-name-btn"
                >
                  {isSavingProfile ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                    </>
                  ) : (
                    'Save name'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>

          <div className="border-t border-hairline pt-6">
            <Form {...passwordForm}>
              <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60">
                    Change Password
                  </p>
                  <p className="text-xs text-secondary">
                    Enter your current password, then choose a new one.
                  </p>
                </div>

                <FormField
                  control={passwordForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">
                        Current Password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          className="rounded-none bg-foreground/5 border-none"
                          disabled={isChangingPassword}
                          data-testid="profile-current-password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">
                        New Password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="rounded-none bg-foreground/5 border-none"
                          disabled={isChangingPassword}
                          data-testid="profile-new-password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">
                        Confirm New Password
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="rounded-none bg-foreground/5 border-none"
                          disabled={isChangingPassword}
                          data-testid="profile-confirm-password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter className="sm:justify-start gap-2">
                  <Button
                    type="submit"
                    className="rounded-none uppercase tracking-widest text-xs font-bold"
                    disabled={isChangingPassword || !auth || !user}
                    data-testid="profile-change-password-btn"
                  >
                    {isChangingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                      </>
                    ) : (
                      'Update password'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
