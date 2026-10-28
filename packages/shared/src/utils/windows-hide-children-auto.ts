/** Side-effect entry: import first in a process entry so later imports already see the patch. */
import { installWindowsHideChildren } from './windows-hide-children.ts';

installWindowsHideChildren();
